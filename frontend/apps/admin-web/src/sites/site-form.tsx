"use client";

/**
 * Create / edit a managed site, including its typed configuration.
 *
 * One component serves both modes so the two screens cannot drift. The form
 * gives immediate feedback for rules it can check locally (required fields,
 * code shape, language sets) but never claims a write is acceptable — the
 * Django serializers, `sites_validate_lifecycle` and the PostgreSQL
 * configuration check are the sole authorities, and their answers are
 * rendered verbatim:
 *
 *   - 400 field errors   -> attached to the offending field, plus a summary
 *   - 409 conflict       -> duplicate code / topology clash
 *   - 412 / 428          -> concurrent edit; ask the user to reload
 *   - 403 permission     -> writes are not enabled in this environment
 *
 * Save order on edit matters: the configuration merge runs *before* the
 * detail PATCH so a newly chosen default language is already present in the
 * enabled set when the backend re-validates the stored document. Each write
 * re-reads the site for a fresh strong ETag instead of reusing the one the
 * page loaded with, so a long editing session cannot fail on staleness alone.
 *
 * The access token never reaches this component: submit calls a server
 * action that reads it from the Auth.js session server-side. Configuration
 * fields are typed — there is no free-text JSON box — so no secret can be
 * entered here, and the backend rejects secret-looking keys regardless.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import CircularProgress from "@mui/material/CircularProgress";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import {
  FormErrorSummary,
  FormField,
  SelectFilter,
  fieldErrorsFrom,
  useToast,
} from "@uog/ui";
import type { Organization, Site, SiteConfiguration, SiteTemplate } from "@uog/types";

import {
  createSite,
  getSite,
  getSiteTemplate,
  listSiteTemplates,
  updateSite,
  updateSiteConfiguration,
} from "@/app/sites/actions";
import { getOrganizationTree } from "@/app/organizations/actions";
import {
  deserializeApiError,
  type ActionResult,
  type ApiErrorPayload,
} from "@/organizations/contract";
import { configurationRows, originCaption } from "@/sites/configuration";
import {
  SITE_THEME_OPTIONS,
  buildConfigurationChanges,
  buildCreateInput,
  buildUpdateInput,
  emptySiteForm,
  formValuesFromSite,
  languageOptions,
  normalizeCode,
  validateSiteForm,
  type SiteFormValues,
} from "@/sites/validation";

interface SiteFormProps {
  /** Existing site being edited, or null to create. */
  site: Site | null;
}

/** Human text for a non-field failure, covering lifecycle/conflict cases. */
function describeFailure(payload: ApiErrorPayload): string {
  switch (payload.status) {
    case 403:
      return "Writing sites is not enabled in this environment. The platform requires development-mode writes to be switched on before these changes are accepted.";
    case 409:
      return "This change conflicts with the current site state — the code may already exist, or the ownership/topology rules forbid it. Reload to see the latest data, then adjust your change.";
    case 412:
      return "This site changed since you opened it. Reload to get the current version, then reapply your edit.";
    case 428:
      return "The update is missing its concurrency token. Reload the site and try again.";
    case 401:
      return "Your session has expired. Sign in again to continue.";
    case 0:
      return "The API could not be reached. Check that the backend is running, then try again.";
    default:
      return payload.message;
  }
}

export function SiteForm({ site }: SiteFormProps) {
  const router = useRouter();
  const toast = useToast();
  const mode: "create" | "edit" = site ? "edit" : "create";

  const [values, setValues] = useState<SiteFormValues>(() =>
    site ? formValuesFromSite(site) : emptySiteForm(),
  );
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const summaryRef = useRef<HTMLDivElement | null>(null);

  // Owner candidates for the select (labels come from the hierarchy read).
  const [owners, setOwners] = useState<Organization[]>([]);
  const [ownersFailed, setOwnersFailed] = useState(false);

  // Templates offered for provisioning; only ACTIVE rows are selectable.
  const [templates, setTemplates] = useState<SiteTemplate[]>([]);
  const [templatesFailed, setTemplatesFailed] = useState(false);

  // Baseline for the inherited/override captions on edit.
  const [baseline, setBaseline] = useState<SiteConfiguration | null>(null);
  const [baselineState, setBaselineState] = useState<
    "none" | "loading" | "ready" | "failed"
  >("none");

  useEffect(() => {
    let cancelled = false;
    getOrganizationTree().then((result: ActionResult<{ results: Organization[] }>) => {
      if (cancelled) return;
      if (result.ok) setOwners(result.data.results);
      else setOwnersFailed(true);
    });
    listSiteTemplates().then((result) => {
      if (cancelled) return;
      if (result.ok) setTemplates(result.data.results);
      else setTemplatesFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!site || site.template === null) {
      setBaseline(null);
      setBaselineState("none");
      return;
    }
    let cancelled = false;
    setBaselineState("loading");
    getSiteTemplate(site.template).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setBaseline(result.data.data.default_configuration);
        setBaselineState("ready");
      } else {
        setBaseline(null);
        setBaselineState("failed");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [site]);

  // Move focus to the error summary after a failed submit so keyboard and
  // screen-reader users land on the problem instead of hunting for it.
  useEffect(() => {
    if (failure || Object.keys(serverErrors).length > 0) {
      summaryRef.current?.focus();
    }
  }, [failure, serverErrors]);

  const setField = (field: keyof SiteFormValues) => (value: string) =>
    setValues((previous) => ({ ...previous, [field]: value }));

  const selectedOwner = useMemo(
    () => owners.find((unit) => String(unit.id) === values.organization_unit),
    [owners, values.organization_unit],
  );
  const ownerIsMainEligible =
    selectedOwner !== undefined &&
    selectedOwner.parent === null &&
    selectedOwner.organization_type === "UNIVERSITY";

  const ownerOptions = useMemo(
    () =>
      owners.map((unit) => ({
        value: String(unit.id),
        label: `${unit.code} — ${unit.name}`,
      })),
    [owners],
  );

  const templateOptions = useMemo(
    () =>
      templates
        .filter((template) => template.status === "ACTIVE")
        .map((template) => ({
          value: String(template.id),
          label: `${template.code} — ${template.name}`,
        })),
    [templates],
  );

  // Provenance captions for the configuration fields (edit mode only).
  const originByKey = useMemo(() => {
    if (!site || baselineState !== "ready" || !baseline) return null;
    const map = new Map<string, string>();
    for (const row of configurationRows(site, baseline)) {
      map.set(row.key, originCaption(row.origin, "the template defaults"));
    }
    return map;
  }, [site, baseline, baselineState]);

  const languageChoices = useMemo(
    () => languageOptions(values.enabled_languages),
    [values.enabled_languages],
  );

  const toggleLanguage = (code: string) =>
    setValues((previous) => ({
      ...previous,
      enabled_languages: previous.enabled_languages.includes(code)
        ? previous.enabled_languages.filter((entry) => entry !== code)
        : [...previous.enabled_languages, code],
    }));

  const fieldIds: Record<string, string> = {
    code: "site-code",
    name: "site-name",
    short_name: "site-short-name",
    organization_unit: "site-owner",
    default_language: "site-default-language",
    template: "site-template",
    display_name: "site-display-name",
    enabled_languages: "site-enabled-languages",
    theme: "site-theme",
  };

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    // 1. Local checks give instant feedback; the server still re-validates.
    const local = validateSiteForm(values, { mode });
    setClientErrors(local);
    setServerErrors({});
    setFailure(null);
    if (Object.keys(local).length > 0) return;

    setPending(true);
    try {
      if (mode === "create") {
        const result = await createSite(buildCreateInput(values));
        if (!result.ok) {
          presentFailure(result);
          return;
        }
        toast.success(`Created ${result.data.data.name} (Draft).`);
        router.push(`/sites/${result.data.data.id}`);
        router.refresh();
        return;
      }

      // Edit: only touch what actually changed, config first so a new
      // default language is already enabled when details are re-validated.
      const original = formValuesFromSite(site!);
      const nextDetails = buildUpdateInput(values);
      const nextConfig = buildConfigurationChanges(values);
      const detailsDirty =
        JSON.stringify(nextDetails) !== JSON.stringify(buildUpdateInput(original));
      const configDirty =
        JSON.stringify(nextConfig) !==
        JSON.stringify(buildConfigurationChanges(original));

      if (!detailsDirty && !configDirty) {
        toast.info("No changes to save.");
        return;
      }

      // Fresh strong ETag for this write — never the one the page loaded.
      const current = await getSite(site!.id);
      if (!current.ok) {
        presentFailure(current);
        return;
      }
      const initialEtag = current.data.etag;
      if (!initialEtag) {
        setFailure(
          describeFailure({
            status: 428,
            code: "precondition_required",
            message:
              "The server did not return a concurrency token for this site.",
            details: null,
            requestId: current.data.requestId,
          }),
        );
        return;
      }
      let etag: string = initialEtag;

      if (configDirty) {
        const configResult = await updateSiteConfiguration(site!.id, etag, nextConfig);
        if (!configResult.ok) {
          presentFailure(configResult);
          return;
        }
        etag = configResult.data.etag ?? etag;
      }

      if (detailsDirty) {
        const detailsResult = await updateSite(site!.id, etag, nextDetails);
        if (!detailsResult.ok) {
          presentFailure(detailsResult);
          return;
        }
      }

      toast.success(`Saved ${values.name.trim()}.`);
      router.push(`/sites/${site!.id}`);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  /** Map a failed result onto field errors or a banner; true when it failed. */
  function presentFailure(
    result: { ok: false; error: ApiErrorPayload } | { ok: true },
  ): boolean {
    if (result.ok) return false;
    const payload = result.error;
    const fields = fieldErrorsFrom(deserializeApiError(payload));
    if (payload.status === 409 && payload.details && typeof payload.details === "object") {
      const details = payload.details as Record<string, unknown>;
      for (const [field, value] of Object.entries(details)) {
        if (Array.isArray(value) && value.length > 0) {
          fields[field] = value.map(String).join(" ");
        }
      }
    }
    if (Object.keys(fields).length > 0) {
      setServerErrors(fields);
    } else {
      setFailure(describeFailure(payload));
    }
    return true;
  }

  const allErrors: Record<string, string> = { ...clientErrors, ...serverErrors };
  const showCode = mode === "create";
  const archived = site?.status === "ARCHIVED";

  return (
    <Paper
      component="form"
      variant="outlined"
      onSubmit={handleSubmit}
      // Validation is ours, not the browser's: native bubbles are not
      // announced reliably, stop at the first invalid field and never show
      // the error summary below.
      noValidate
      sx={{ p: { xs: 2.5, sm: 3.5 }, display: "flex", flexDirection: "column", gap: 2.5 }}
    >
      <Box
        ref={summaryRef}
        tabIndex={-1}
        sx={{ display: "flex", flexDirection: "column", gap: 2, outline: "none" }}
      >
        <FormErrorSummary errors={allErrors} fieldIds={fieldIds} />

        {failure ? (
          <Alert severity="error" role="alert">
            {failure}
          </Alert>
        ) : null}

        {ownersFailed ? (
          <Alert severity="warning">
            The owner list could not be loaded. You can still save with an
            explicit owner, but the selector may be incomplete.
          </Alert>
        ) : null}

        {templatesFailed ? (
          <Alert severity="warning">
            The template list could not be loaded. Saving without a template
            uses the platform defaults.
          </Alert>
        ) : null}
      </Box>

      {mode === "create" ? (
        <Alert severity="info" variant="outlined">
          New sites start as <strong>Draft</strong>. A site becomes servable
          only through the explicit Activate action, which the platform
          checks against the owning unit&apos;s state. DNS and TLS provisioning
          are not part of this platform and are never implied here.
        </Alert>
      ) : null}

      {archived ? (
        <Alert severity="warning">
          This site is archived — a terminal state. Ownership and the main
          designation are frozen by the platform and their controls are
          disabled; name, language and settings corrections are still allowed.
        </Alert>
      ) : null}

      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
        }}
      >
        {showCode ? (
          <FormField
            label="Code"
            name="code"
            value={values.code}
            onChange={setField("code")}
            error={allErrors.code}
            hint="Uppercase letters, digits, _ or -. Immutable once created."
            required
            placeholder="COI_PORTAL"
          />
        ) : (
          <TextField
            id="site-code"
            label="Code"
            value={values.code}
            size="small"
            fullWidth
            disabled
            helperText="Codes cannot be changed after creation."
            inputProps={{ readOnly: true, "aria-readonly": true }}
          />
        )}

        <Box>
          <SelectFilter
            id="site-template"
            label="Template"
            value={values.template}
            options={templateOptions}
            onChange={setField("template")}
            includeAll
            allLabel="None (platform defaults)"
          />
          <Typography
            variant="caption"
            color={allErrors.template ? "error" : "text.secondary"}
            role={allErrors.template ? "alert" : undefined}
            sx={{ display: "block", mt: 0.5 }}
          >
            {allErrors.template ??
              "Optional. The template's approved defaults are copied once at creation; later template edits never change this site."}
          </Typography>
        </Box>
      </Box>

      <FormField
        label="Name"
        name="name"
        value={values.name}
        onChange={setField("name")}
        error={allErrors.name}
        hint="Full public name of the website."
        required
      />

      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
        }}
      >
        <FormField
          label="Short name"
          name="short_name"
          value={values.short_name}
          onChange={setField("short_name")}
          error={allErrors.short_name}
          hint="Optional abbreviation shown in tight layouts."
        />

        <Box>
          <SelectFilter
            id="site-owner"
            label="Owning organization"
            value={values.organization_unit}
            options={ownerOptions}
            onChange={setField("organization_unit")}
            includeAll={false}
            disabled={archived}
          />
          <Typography
            variant="caption"
            color={allErrors.organization_unit ? "error" : "text.secondary"}
            role={allErrors.organization_unit ? "alert" : undefined}
            sx={{ display: "block", mt: 0.5 }}
          >
            {allErrors.organization_unit ??
              (archived
                ? "Archived sites cannot change owner."
                : "One organization may own several sites; the server validates the owner's state.")}
          </Typography>
        </Box>
      </Box>

      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
        }}
      >
        <Box>
          <SelectFilter
            id="site-default-language"
            label="Default language"
            value={values.default_language}
            options={languageChoices}
            onChange={setField("default_language")}
            includeAll={false}
          />
          <Typography
            variant="caption"
            color={allErrors.default_language ? "error" : "text.secondary"}
            role={allErrors.default_language ? "alert" : undefined}
            sx={{ display: "block", mt: 0.5 }}
          >
            {allErrors.default_language ??
              "Normalized code such as en or am. Must be one of the enabled languages below."}
          </Typography>
        </Box>

        <Box>
          <FormControlLabel
            control={
              <Checkbox
                checked={values.is_main}
                onChange={(event) =>
                  setValues((previous) => ({
                    ...previous,
                    is_main: event.target.checked,
                  }))
                }
                disabled={archived || !ownerIsMainEligible}
                inputProps={{ "aria-describedby": "site-main-hint" }}
              />
            }
            label="Main university site"
          />
          <Typography
            id="site-main-hint"
            variant="caption"
            color={allErrors.organization_unit ? "error" : "text.secondary"}
            role={allErrors.organization_unit ? "alert" : undefined}
            sx={{ display: "block", mt: 0.5 }}
          >
            {allErrors.organization_unit ??
              (values.is_main && !ownerIsMainEligible
                ? "The main site must belong to the UNIVERSITY root."
                : ownerIsMainEligible
                  ? "The main designation is only allowed for the UNIVERSITY root unit."
                  : "Select the UNIVERSITY root as owner to enable this designation.")}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ borderTop: 1, borderColor: "divider", pt: 2.5, display: "flex", flexDirection: "column", gap: 2 }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Settings
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Typed, allowlisted configuration fields only (schema v1) — there is
            no free-form JSON here, and the platform rejects secret-like keys
            server-side.
            {originByKey ? " Captions show inherited values versus overrides." : ""}
          </Typography>
        </Box>

        <FormField
          label="Display name"
          name="display_name"
          value={values.display_name}
          onChange={setField("display_name")}
          error={allErrors.display_name}
          hint={
            originByKey?.get("display_name") ??
            "Leave blank to use the site name everywhere."
          }
        />

        <Box id="site-enabled-languages">
          <Typography variant="overline" color="text.secondary">
            Enabled languages
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
            {languageChoices.map((option) => (
              <FormControlLabel
                key={option.value}
                control={
                  <Checkbox
                    checked={values.enabled_languages.includes(option.value)}
                    onChange={() => toggleLanguage(option.value)}
                    size="small"
                  />
                }
                label={option.label}
              />
            ))}
          </Box>
          <Typography
            variant="caption"
            color={allErrors.enabled_languages ? "error" : "text.secondary"}
            role={allErrors.enabled_languages ? "alert" : undefined}
            sx={{ display: "block", mt: 0.5 }}
          >
            {allErrors.enabled_languages ??
              (originByKey?.get("enabled_languages") ??
                "One to ten unique codes; the default language must be included.")}
          </Typography>
        </Box>

        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
          }}
        >
          <Box>
            <SelectFilter
              id="site-theme"
              label="Theme"
              value={values.theme}
              options={[...SITE_THEME_OPTIONS]}
              onChange={setField("theme")}
              includeAll={false}
            />
            <Typography
              variant="caption"
              color={allErrors.theme ? "error" : "text.secondary"}
              role={allErrors.theme ? "alert" : undefined}
              sx={{ display: "block", mt: 0.5 }}
            >
              {allErrors.theme ??
                (originByKey?.get("theme") ?? "Approved themes only.")}
            </Typography>
          </Box>

          <Box sx={{ display: "flex", flexDirection: "column" }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={values.show_search}
                  onChange={(event) =>
                    setValues((previous) => ({
                      ...previous,
                      show_search: event.target.checked,
                    }))
                  }
                />
              }
              label="Show search box"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={values.show_language_switcher}
                  onChange={(event) =>
                    setValues((previous) => ({
                      ...previous,
                      show_language_switcher: event.target.checked,
                    }))
                  }
                />
              }
              label="Show language switcher"
            />
            {originByKey?.get("show_search") ? (
              <Typography variant="caption" color="text.secondary">
                {originByKey.get("show_search")}
              </Typography>
            ) : null}
          </Box>
        </Box>
      </Box>

      <Box sx={{ display: "flex", gap: 1.5, justifyContent: "flex-end", pt: 0.5 }}>
        <Button
          type="button"
          variant="outlined"
          color="inherit"
          disabled={pending}
          onClick={() => router.push(site ? `/sites/${site.id}` : "/sites")}
        >
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={pending}>
          {pending ? (
            <>
              <CircularProgress size={16} sx={{ mr: 1 }} color="inherit" />
              Saving…
            </>
          ) : mode === "create" ? (
            "Create site"
          ) : (
            "Save changes"
          )}
        </Button>
      </Box>
    </Paper>
  );
}
