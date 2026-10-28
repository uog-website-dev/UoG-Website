"use client";

/**
 * Per-Site module configuration: which registry capabilities this site has
 * enabled, and the controls to change that.
 *
 * Reads go through server actions (`listPlatformModules`,
 * `listSiteModuleAssignments`), so the Keycloak access token stays
 * server-side. Writes go through `enableSiteModule`, `disableSiteModule`
 * and `updateSiteModuleSettings`, each of which fetches a fresh strong ETag
 * immediately before the conditional call.
 *
 * Honesty rules this screen encodes:
 *
 *   - a registry row is a capability *announcement*, never a working
 *     feature: only a module that is IMPLEMENTED and switched on
 *     platform-wide shows an available state, and the backend re-verifies
 *     it is shipped before accepting any write;
 *   - PLANNED/DEPRECATED/globally-disabled rows get no enable control at
 *     all, with the reason spelled out inline;
 *   - disabling keeps the assignment row and its configuration, and the
 *     screen says so — toggling never deletes data;
 *   - a failed assignments read hides the controls instead of guessing,
 *     because without knowing the current rows an enable could collide.
 *
 * Client-side settings validation only gives early feedback; the Django
 * serializer and the module schema validate authoritatively, and their 400
 * answers are rendered verbatim (field errors under their own keys, the
 * rest as a row banner with the request id).
 */
import { useState } from "react";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import PowerSettingsNewIcon from "@mui/icons-material/PowerSettingsNew";
import TuneIcon from "@mui/icons-material/Tune";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import {
  ApiErrorState,
  ConfirmDialog,
  EmptyState,
  FormErrorSummary,
  LoadingState,
  Pagination,
  fieldErrorsFrom,
  useAsync,
  useToast,
} from "@uog/ui";
import { ApiError, SITES_PAGE_SIZE } from "@uog/api-client";
import type {
  PaginatedResponse,
  PlatformModule,
  Site,
  SiteModuleAssignment,
} from "@uog/types";

import { Breadcrumb } from "@/breadcrumb";
import {
  listPlatformModules,
  listSiteModuleAssignments,
  disableSiteModule,
  enableSiteModule,
  updateSiteModuleSettings,
} from "@/app/sites/actions";
import { deserializeApiError, unwrap } from "@/organizations/contract";
import type { ApiErrorPayload } from "@/organizations/contract";
import {
  ModuleSettingsForm,
  settingsFieldId,
} from "@/sites/module-settings-form";
import {
  availabilityMessage,
  buildSettingsPayload,
  isModuleAvailable,
  moduleAvailabilityChip,
  moduleSchemaProperties,
  moduleStatusChip,
  settingsFromConfiguration,
  settingsSummary,
  validateSettings,
} from "@/modules/validation";
import type { ModuleSettings } from "@/modules/validation";

interface SiteModulesProps {
  site: Site | null;
  error?: ApiErrorPayload;
}

/** Human text for a non-field write failure. */
function describeFailure(payload: ApiErrorPayload): string {
  switch (payload.status) {
    case 403:
      return "Writing site modules is not enabled in this environment. The platform requires development-mode writes to be switched on before this change is accepted.";
    case 409:
      return "This module was already enabled for the site by someone else. Reload to see the current state.";
    case 412:
      return "This module changed since you loaded it. Reload to get the current version, then try again.";
    case 428:
      return "The change is missing its concurrency token. Reload and try again.";
    case 401:
      return "Your session has expired. Sign in again to continue.";
    case 0:
      return "The API could not be reached. Check that the backend is running, then try again.";
    default:
      return payload.message;
  }
}

export function SiteModules({ site, error }: SiteModulesProps) {
  const toast = useToast();

  // Registry page state: the registry is a real paginated endpoint (20 per
  // page), so this screen pages it rather than pretending it is complete.
  const [page, setPage] = useState(1);
  const registry = useAsync<PaginatedResponse<PlatformModule> | null>(
    async () => unwrap(await listPlatformModules({ page })),
    [page],
  );
  const assignments = useAsync<
    PaginatedResponse<SiteModuleAssignment> | null
  >(
    async () => (site ? unwrap(await listSiteModuleAssignments(site.id)) : null),
    [site?.id],
  );

  // Settings panel state: one open module at a time, with its draft.
  const [openModule, setOpenModule] = useState<number | null>(null);
  const [draft, setDraft] = useState<ModuleSettings>({});
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<number, ApiErrorPayload>>(
    {},
  );
  const [pendingModule, setPendingModule] = useState<number | null>(null);

  // Disable confirmation.
  const [confirmRow, setConfirmRow] =
    useState<SiteModuleAssignment | null>(null);
  const [confirmError, setConfirmError] = useState<ApiError | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);

  if (!site) {
    const failure = error
      ? deserializeApiError(error)
      : new ApiError("The site could not be loaded.", 0, {
          code: "api_error",
        });

    if (failure.status === 404) {
      return (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <Breadcrumb
            items={[
              { label: "Home", href: "/" },
              { label: "Sites", href: "/sites" },
              { label: "Unavailable" },
            ]}
          />
          <Paper variant="outlined" sx={{ borderRadius: 3, textAlign: "center" }}>
            <Box
              sx={{
                display: "grid",
                justifyItems: "center",
                gap: 1.5,
                px: 3,
                py: { xs: 6, sm: 8 },
              }}
            >
              <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
                Site unavailable
              </Typography>
              <Typography color="text.secondary" sx={{ maxWidth: 520 }}>
                This site may no longer exist or may not be available to your
                account. Return to the directory to check the current list.
              </Typography>
              <Button
                component={Link}
                href="/sites"
                variant="contained"
                startIcon={<ArrowBackIcon />}
                sx={{ mt: 1 }}
              >
                Back to sites
              </Button>
            </Box>
          </Paper>
        </Box>
      );
    }

    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            { label: "Sites", href: "/sites" },
            { label: "Not available" },
          ]}
        />
        <ApiErrorState error={failure} onRetry={() => window.location.reload()} />
      </Box>
    );
  }

  const assignmentRows = assignments.data?.results ?? [];
  const assignmentByModule = new Map(
    assignmentRows.map((row) => [row.module, row]),
  );
  const assignmentsTruncated =
    assignments.data !== null &&
    assignments.data.count > assignmentRows.length;

  function clearRowError(moduleId: number) {
    setRowErrors((previous) => {
      if (!(moduleId in previous)) return previous;
      const next = { ...previous };
      delete next[moduleId];
      return next;
    });
  }

  function openSettings(
    module: PlatformModule,
    assignment: SiteModuleAssignment | null,
  ) {
    const properties = moduleSchemaProperties(module);
    if (properties === null) return;
    setOpenModule(module.id);
    setDraft(settingsFromConfiguration(properties, assignment?.configuration));
    setFormErrors({});
  }

  /** Enable flow: with settings to collect, open the form first. */
  function handleEnable(
    module: PlatformModule,
    assignment: SiteModuleAssignment | null,
  ) {
    const properties = moduleSchemaProperties(module);
    if (properties !== null && properties.length > 0 && !assignment) {
      openSettings(module, assignment);
      return;
    }
    void runWrite(module, async () => {
      const result = await enableSiteModule(site!.id, module.id);
      if (!result.ok) return result;
      toast.success(`${module.code} enabled for ${site!.name}.`);
      return result;
    });
  }

  /** Submit the open settings panel (create-with-settings or PATCH). */
  async function submitPanel() {
    const module = registry.data?.results.find(
      (entry) => entry.id === openModule,
    );
    if (!module) return;
    const properties = moduleSchemaProperties(module);
    if (properties === null) return;
    const assignment = assignmentByModule.get(module.id) ?? null;

    const local = validateSettings(properties, draft);
    setFormErrors(local);
    if (Object.keys(local).length > 0) return;

    const payload = buildSettingsPayload(properties, draft);
    await runWrite(module, async () => {
      const result = assignment
        ? await updateSiteModuleSettings(site!.id, assignment.id, payload)
        : await enableSiteModule(site!.id, module.id, payload);
      if (!result.ok) {
        const fields = fieldErrorsFrom(deserializeApiError(result.error));
        if (Object.keys(fields).length > 0) {
          setFormErrors(fields);
          return null; // shown in place; no row banner needed
        }
        return result;
      }
      toast.success(
        assignment
          ? `Settings saved for ${module.code}.`
          : `${module.code} enabled for ${site!.name}.`,
      );
      setOpenModule(null);
      return result;
    });
  }

  /**
   * Shared write runner: reports failures (field errors surface inside the
   * open panel, everything else as a row banner) and refreshes the module
   * state on success.
   */
  async function runWrite(
    module: PlatformModule,
    action: () => Promise<
      { ok: true; data: unknown } | { ok: false; error: ApiErrorPayload } | null
    >,
  ) {
    setPendingModule(module.id);
    clearRowError(module.id);
    try {
      const outcome = await action();
      if (outcome === null) return;
      if (!outcome.ok) {
        setRowErrors((previous) => ({ ...previous, [module.id]: outcome.error }));
        return;
      }
      setOpenModule((current) => (current === module.id ? null : current));
      setFormErrors({});
      assignments.reload();
    } finally {
      setPendingModule(null);
    }
  }

  async function runDisable() {
    if (!confirmRow) return;
    const module = registry.data?.results.find(
      (entry) => entry.id === confirmRow.module,
    );
    setConfirmPending(true);
    setConfirmError(null);
    try {
      const result = await disableSiteModule(site!.id, confirmRow.id);
      if (!result.ok) {
        setConfirmError(deserializeApiError(result.error));
        return;
      }
      toast.success(
        `${module?.code ?? `Module #${confirmRow.module}`} disabled for ${site!.name}. Its settings are kept.`,
      );
      setConfirmRow(null);
      assignments.reload();
    } finally {
      setConfirmPending(false);
    }
  }

  const modules = registry.data?.results ?? [];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Box>
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            { label: "Sites", href: "/sites" },
            { label: site.name, href: `/sites/${site.id}` },
            { label: "Modules" },
          ]}
        />
        <Paper
          variant="outlined"
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 2,
            p: { xs: 2.5, sm: 3.5 },
            borderRadius: 3,
            background:
              "linear-gradient(115deg, rgba(0,51,102,0.08), rgba(255,255,255,0.96) 64%, rgba(255,184,28,0.14))",
          }}
        >
          <Box>
            <Chip
              size="small"
              label={site.code}
              color="primary"
              variant="outlined"
              sx={{ mb: 1, fontWeight: 600, fontFamily: "monospace" }}
            />
            <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
              Modules — {site.name}
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
              Enable or disable platform capabilities for this site and edit
              their settings. Only implemented, platform-wide enabled modules
              can be turned on; a registry record alone never means the
              feature works.
            </Typography>
          </Box>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            <Button
              component={Link}
              href={`/sites/${site.id}`}
              startIcon={<ArrowBackIcon />}
              variant="outlined"
            >
              Site details
            </Button>
            <Button component={Link} href="/modules" variant="outlined">
              Module registry
            </Button>
          </Box>
        </Paper>
      </Box>

      {assignments.error ? (
        <Alert severity="warning" variant="outlined">
          The current module state for this site could not be loaded:{" "}
          {assignments.error.message}
          {assignments.error.requestId
            ? ` (reference ${assignments.error.requestId})`
            : ""}
          . Enable, disable and settings controls are hidden until this read
          succeeds — a read failure does not mean no modules are enabled.
        </Alert>
      ) : null}

      {assignmentsTruncated ? (
        <Alert severity="info" variant="outlined">
          This site has {assignments.data!.count} module assignments; only the
          first {assignmentRows.length} are shown here.
        </Alert>
      ) : null}

      <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 3 }}>
        <Box sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Module registry
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Platform capabilities and their availability for this site. The
            server is the authority on every change: it re-checks availability
            and validates settings on each write.
          </Typography>
        </Box>
        <Divider />

        {registry.loading ? (
          <Box sx={{ px: { xs: 2, sm: 3 } }}>
            <LoadingState label="Loading module registry…" />
          </Box>
        ) : registry.error ? (
          <Box sx={{ px: { xs: 2, sm: 3 } }}>
            <ApiErrorState
              error={registry.error}
              title="Module registry unavailable"
              onRetry={() => registry.reload()}
            />
          </Box>
        ) : modules.length === 0 ? (
          <EmptyState
            title="No modules registered"
            description="The platform module registry is empty, so no capability can be enabled for this site. Registering a row is not the same as implementing a feature."
          />
        ) : (
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none" }}>
            {modules.map((module) => {
              const assignment = assignmentByModule.get(module.id) ?? null;
              const available = isModuleAvailable(module);
              const statusChip = moduleStatusChip(module);
              const availability = moduleAvailabilityChip(module);
              const properties = moduleSchemaProperties(module);
              const rowError = rowErrors[module.id];
              const isOpen = openModule === module.id;
              const busy = pendingModule === module.id;
              const controlsHidden = Boolean(assignments.error);
              const showEnable =
                !controlsHidden &&
                available &&
                (assignment === null || !assignment.is_enabled);
              const showDisable =
                !controlsHidden && assignment !== null && assignment.is_enabled;
              const showSettings =
                !controlsHidden &&
                assignment !== null &&
                properties !== null &&
                properties.length > 0;

              return (
                <Box
                  component="li"
                  key={module.id}
                  sx={{ borderBottom: 1, borderColor: "divider", "&:last-child": { borderBottom: 0 } }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: 1.5,
                      px: { xs: 2, sm: 3 },
                      py: 2,
                    }}
                  >
                    <Box sx={{ minWidth: 0, flex: "1 1 320px" }}>
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          flexWrap: "wrap",
                        }}
                      >
                        <Typography sx={{ fontWeight: 700 }}>
                          {module.code} — {module.name}
                        </Typography>
                        <Chip
                          size="small"
                          variant="outlined"
                          color={statusChip.color}
                          label={statusChip.label}
                        />
                        <Chip
                          size="small"
                          variant="filled"
                          color={availability.color}
                          label={availability.label}
                        />
                        {assignment ? (
                          <Chip
                            size="small"
                            variant="outlined"
                            color={assignment.is_enabled ? "success" : "default"}
                            label={
                              assignment.is_enabled
                                ? "Enabled on this site"
                                : "Disabled on this site"
                            }
                          />
                        ) : null}
                      </Box>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mt: 0.75 }}
                      >
                        {module.description}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {availabilityMessage(module)}
                      </Typography>
                      {assignment ? (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: "block", mt: 0.5, fontFamily: "monospace" }}
                        >
                          {settingsSummary(assignment.configuration)}
                        </Typography>
                      ) : null}
                    </Box>

                    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                      {showEnable ? (
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<PowerSettingsNewIcon />}
                          disabled={busy}
                          onClick={() => handleEnable(module, assignment)}
                        >
                          Enable
                        </Button>
                      ) : null}
                      {showDisable ? (
                        <Button
                          size="small"
                          variant="outlined"
                          color="warning"
                          disabled={busy}
                          onClick={() => {
                            setConfirmError(null);
                            setConfirmRow(assignment);
                          }}
                        >
                          Disable
                        </Button>
                      ) : null}
                      {showSettings ? (
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<TuneIcon />}
                          disabled={busy}
                          onClick={() => {
                            if (isOpen) {
                              setOpenModule(null);
                              setFormErrors({});
                            } else {
                              openSettings(module, assignment);
                            }
                          }}
                        >
                          {isOpen ? "Close settings" : "Settings"}
                        </Button>
                      ) : null}
                    </Box>
                  </Box>

                  {rowError ? (
                    <Box sx={{ px: { xs: 2, sm: 3 }, pb: 2 }}>
                      <Alert
                        severity="error"
                        onClose={() => clearRowError(module.id)}
                      >
                        {describeFailure(rowError)}
                        {rowError.requestId
                          ? ` (reference ${rowError.requestId})`
                          : ""}
                      </Alert>
                    </Box>
                  ) : null}

                  {isOpen && properties !== null ? (
                    <Box
                      sx={{
                        px: { xs: 2, sm: 3 },
                        py: 2,
                        borderTop: 1,
                        borderColor: "divider",
                        bgcolor: "action.hover",
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                          {assignment
                            ? `${module.code} settings`
                            : `Enable ${module.code}`}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {assignment
                            ? "Saving replaces this site's settings for the module; enablement is unchanged. The server validates every value against the approved schema."
                            : "These settings are stored with the module for this site. The server validates every value against the approved schema."}
                        </Typography>
                      </Box>

                      <FormErrorSummary
                        errors={formErrors}
                        title="Check the settings and try again"
                        fieldIds={Object.fromEntries(
                          properties.map((property) => [
                            property.code,
                            settingsFieldId(property),
                          ]),
                        )}
                      />

                      {properties.length === 0 ? (
                        <Alert severity="info" variant="outlined">
                          This module has no configurable settings.
                        </Alert>
                      ) : (
                        <ModuleSettingsForm
                          properties={properties}
                          values={draft}
                          errors={formErrors}
                          disabled={busy}
                          onChange={(code, value) =>
                            setDraft((previous) => ({
                              ...previous,
                              [code]: value,
                            }))
                          }
                        />
                      )}

                      <Box sx={{ display: "flex", gap: 1 }}>
                        <Button
                          variant="contained"
                          disabled={busy}
                          onClick={() => void submitPanel()}
                        >
                          {assignment ? "Save settings" : "Enable module"}
                        </Button>
                        <Button
                          variant="outlined"
                          disabled={busy}
                          onClick={() => {
                            setOpenModule(null);
                            setFormErrors({});
                          }}
                        >
                          Cancel
                        </Button>
                      </Box>
                    </Box>
                  ) : null}
                </Box>
              );
            })}
          </Box>
        )}

        {registry.data && registry.data.count > modules.length ? (
          <>
            <Divider />
            <Pagination
              page={page}
              count={registry.data.count}
              pageSize={SITES_PAGE_SIZE}
              onPageChange={(next) => {
                setPage(next);
                setOpenModule(null);
              }}
              label="Module registry pagination"
            />
          </>
        ) : null}
      </Paper>

      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          px: 1,
          color: "text.secondary",
        }}
      >
        <CheckCircleOutlineIcon fontSize="small" />
        <Typography variant="body2">
          Disabling a module keeps its row and stored settings — no module data
          is deleted by turning a capability off.
        </Typography>
      </Box>

      <ConfirmDialog
        open={confirmRow !== null}
        title="Disable this module for the site?"
        description="The module stops being available on this site. Its row and stored settings are kept, so re-enabling later restores exactly the same configuration — nothing is deleted."
        confirmColor="error"
        confirmLabel="Disable"
        pending={confirmPending}
        error={confirmError}
        onConfirm={() => void runDisable()}
        onCancel={() => {
          if (!confirmPending) {
            setConfirmRow(null);
            setConfirmError(null);
          }
        }}
      >
        {confirmRow ? (
          <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
            {site.code} ·{" "}
            {registry.data?.results.find((entry) => entry.id === confirmRow.module)
              ?.code ?? `Module #${confirmRow.module}`}
          </Typography>
        ) : null}
      </ConfirmDialog>
    </Box>
  );
}
