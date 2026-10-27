"use client";

/**
 * Site detail: read-only inspection of one managed site, its lifecycle
 * controls and its configuration with provenance.
 *
 * The read runs through the `getSite` server action, so the Keycloak access
 * token stays server-side; the view only sees approved DTO fields. Lifecycle
 * changes are confirmed first and then executed against a fresh strong ETag
 * fetched inside the action, so a stale row can never silently win.
 *
 * Configuration provenance is derived, not stored: a value is shown as
 * *inherited* while the Site's document still equals the defaults it was
 * provisioned from (its template's `default_configuration`, or the schema
 * defaults when it has no template), and as an *override* once it differs.
 * If the template's defaults cannot be read, the comparison is reported as
 * unavailable rather than guessed.
 *
 * Nothing here implies DNS, TLS or public provisioning: the platform API
 * exposes none of that, so the screen makes no such claim.
 */
import { useEffect, useState } from "react";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import LanguageRoundedIcon from "@mui/icons-material/LanguageRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiErrorState, ConfirmDialog, useAsync, useToast } from "@uog/ui";
import { ApiError } from "@uog/api-client";
import type {
  OrganizationHierarchy,
  PaginatedResponse,
  PlatformModule,
  Site,
  SiteConfiguration,
  SiteDomain,
  SiteModuleAssignment,
  SiteStatus,
} from "@uog/types";

import { Breadcrumb } from "@/breadcrumb";
import {
  activateSite,
  archiveSite,
  getSiteTemplate,
  listPlatformModules,
  listSiteDomains,
  listSiteModuleAssignments,
  suspendSite,
} from "@/app/sites/actions";
import { getOrganizationTree } from "@/app/organizations/actions";
import { deserializeApiError, unwrap } from "@/organizations/contract";
import type { ApiErrorPayload } from "@/organizations/contract";
import { configurationRows, originCaption } from "@/sites/configuration";
import { ownerInfoFor, relationLabel } from "@/sites/owner";
import { siteStatusChip, siteStatusLabel } from "@/sites/validation";

type LifecycleAction = "activate" | "suspend" | "archive";

interface SiteDetailProps {
  site: Site | null;
  error?: ApiErrorPayload;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(date);
}

/** Next lifecycle steps per state — mirrors the backend transition matrix. */
function availableActions(status: SiteStatus): LifecycleAction[] {
  switch (status) {
    case "DRAFT":
      return ["activate", "archive"];
    case "ACTIVE":
      return ["suspend", "archive"];
    case "SUSPENDED":
      return ["activate", "archive"];
    case "ARCHIVED":
      return [];
  }
}

const ACTION_LABELS: Record<LifecycleAction, string> = {
  activate: "Activate",
  suspend: "Suspend",
  archive: "Archive",
};

const CONFIRM_COPY: Record<LifecycleAction, { title: string; description: string }> = {
  activate: {
    title: "Activate site?",
    description:
      "The site becomes publicly servable. The owning organization unit must be active — if it is not, the server refuses the change and the reason is shown here.",
  },
  suspend: {
    title: "Suspend site?",
    description:
      "The site stops being served but keeps its row, configuration and owner link. It can be activated again.",
  },
  archive: {
    title: "Archive site?",
    description:
      "Archiving is final: no further activation, suspension, ownership change or main-site change is possible. The row is retained as history.",
  },
};

export function SiteDetail({ site, error }: SiteDetailProps) {
  const router = useRouter();
  const toast = useToast();

  const [pending, setPending] = useState(false);
  const [confirmAction, setConfirmAction] = useState<LifecycleAction | null>(null);
  const [confirmError, setConfirmError] = useState<ApiError | null>(null);

  // Baseline for the inherited/override comparison: the provisioning
  // template's defaults. `null` template means schema factory defaults, so
  // only a real template needs a read.
  const [template, setTemplate] = useState<{
    code: string;
    configuration: SiteConfiguration;
  } | null>(null);
  const [baseline, setBaseline] = useState<"none" | "loading" | "ready" | "failed">(
    "none",
  );

  useEffect(() => {
    if (!site || site.template === null) {
      setTemplate(null);
      setBaseline("none");
      return;
    }
    let cancelled = false;
    setBaseline("loading");
    getSiteTemplate(site.template).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setTemplate({
          code: result.data.data.code,
          configuration: result.data.data.default_configuration,
        });
        setBaseline("ready");
      } else {
        setTemplate(null);
        setBaseline("failed");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [site]);

  // Owner context: the flat hierarchy read labels each site's owner without
  // the site payload having to carry organization data.
  const ownerTree = useAsync<OrganizationHierarchy>(
    async () => unwrap(await getOrganizationTree()),
    [],
  );

  // Domains and module rows are per-site reads; failures degrade to an
  // explicit "could not be loaded" message rather than an empty panel, so
  // missing data is never mistaken for "no domains / no modules".
  const domains = useAsync<PaginatedResponse<SiteDomain> | null>(
    async () => (site ? unwrap(await listSiteDomains(site.id)) : null),
    [site?.id],
  );
  const assignments = useAsync<PaginatedResponse<SiteModuleAssignment> | null>(
    async () => (site ? unwrap(await listSiteModuleAssignments(site.id)) : null),
    [site?.id],
  );
  const registry = useAsync<PaginatedResponse<PlatformModule> | null>(
    async () => unwrap(await listPlatformModules()),
    [],
  );

  if (!site) {
    const failure = error
      ? deserializeApiError(error)
      : new ApiError("The site could not be loaded.", 0, { code: "api_error" });

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
          <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 3, textAlign: "center" }}>
            <Box
              sx={{
                display: "grid",
                justifyItems: "center",
                gap: 1.5,
                px: 3,
                py: { xs: 6, sm: 8 },
                background:
                  "linear-gradient(145deg, rgba(0,51,102,0.07), rgba(255,184,28,0.12))",
              }}
            >
              <Typography variant="h5" component="h1" sx={{ fontWeight: 700, mt: 1 }}>
                Site unavailable
              </Typography>
              <Typography color="text.secondary" sx={{ maxWidth: 520 }}>
                This site may no longer exist or may not be available to your
                account. Return to the directory to check the current list.
              </Typography>
              <Button component={Link} href="/sites" variant="contained" startIcon={<ArrowBackIcon />} sx={{ mt: 1 }}>
                Back to sites
              </Button>
            </Box>
            {failure.requestId ? (
              <>
                <Divider />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", px: 2, py: 1.5, fontFamily: "monospace" }}
                >
                  Reference: {failure.requestId}
                </Typography>
              </>
            ) : null}
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

  const chip = siteStatusChip(site.status);
  const actions = availableActions(site.status);
  const units = ownerTree.data?.results ?? [];
  const owner = ownerInfoFor(site, units);
  const ownerStatusChip = owner.ownerStatus
    ? owner.ownerStatus === "ACTIVE"
      ? { color: "success" as const, label: "Active" }
      : owner.ownerStatus === "INACTIVE"
        ? { color: "warning" as const, label: "Inactive" }
        : { color: "default" as const, label: "Archived" }
    : null;
  const moduleById = new Map(
    (registry.data?.results ?? []).map((entry) => [entry.id, entry]),
  );
  const baselineLabel =
    template ? `template ${template.code}` : "the platform defaults";
  const showOrigins = site.template === null || baseline === "ready";
  const rows = configurationRows(site, template?.configuration ?? null);

  const fields = [
    { label: "Code", value: site.code, monospace: true },
    {
      label: "Designation",
      value: site.is_main ? "Main university site" : "Standard site",
    },
    { label: "Default language", value: site.default_language },
    {
      label: "Enabled languages",
      value: site.configuration.language.enabled.join(", "),
      monospace: true,
    },
    {
      label: "Template",
      value: template
        ? `${template.code} — inherited settings baseline`
        : site.template === null
          ? "None (platform defaults)"
          : `#${site.template}`,
    },
    { label: "Created", value: formatTimestamp(site.created_at) },
    { label: "Last updated", value: formatTimestamp(site.updated_at) },
  ];

  async function runLifecycle(action: LifecycleAction) {
    setPending(true);
    setConfirmError(null);
    try {
      const result =
        action === "activate"
          ? await activateSite(site!.id)
          : action === "suspend"
            ? await suspendSite(site!.id)
            : await archiveSite(site!.id);

      if (!result.ok) {
        setConfirmError(deserializeApiError(result.error));
        return;
      }

      const pastTense: Record<LifecycleAction, string> = {
        activate: "activated",
        suspend: "suspended",
        archive: "archived",
      };
      toast.success(`${site!.name} ${pastTense[action]}.`);
      setConfirmAction(null);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Box>
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            { label: "Sites", href: "/sites" },
            { label: site.name },
          ]}
        />
        <Paper
          variant="outlined"
          sx={{
            position: "relative",
            overflow: "hidden",
            borderRadius: 3,
            p: { xs: 2.5, sm: 4 },
            background:
              "linear-gradient(125deg, rgba(0,51,102,0.08) 0%, rgba(255,255,255,1) 58%, rgba(255,184,28,0.13) 100%)",
            "&::before": {
              content: '""',
              position: "absolute",
              inset: "0 auto 0 0",
              width: 5,
              bgcolor: "secondary.main",
            },
          }}
        >
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 2.5,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "flex-start", gap: 2 }}>
              <Box
                sx={{
                  display: { xs: "none", sm: "grid" },
                  placeItems: "center",
                  flex: "0 0 auto",
                  width: 56,
                  height: 56,
                  borderRadius: 2.5,
                  bgcolor: "primary.main",
                  color: "primary.contrastText",
                  boxShadow: 2,
                }}
              >
                <LanguageRoundedIcon />
              </Box>
              <Box>
                <Typography
                  variant="overline"
                  color="primary.main"
                  sx={{ fontWeight: 700, letterSpacing: 1.2 }}
                >
                  Site profile
                </Typography>
                <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1.25 }}>
                  <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
                    {site.name}
                  </Typography>
                  <Chip
                    size="small"
                    color={chip.color}
                    label={chip.label}
                    variant="outlined"
                    sx={{ fontWeight: 600 }}
                  />
                </Box>
                <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                  <Box component="span" sx={{ fontFamily: "monospace", fontWeight: 600 }}>
                    {site.code}
                  </Box>
                  {" · "}
                  {siteStatusLabel(site.status)}
                  {site.is_main ? " · main university site" : ""}
                </Typography>
              </Box>
            </Box>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              <Button component={Link} href="/sites" startIcon={<ArrowBackIcon />} variant="outlined">
                Directory
              </Button>
              {site.status !== "ARCHIVED" ? (
                <Button
                  component={Link}
                  href={`/sites/${site.id}/edit`}
                  variant="contained"
                  startIcon={<EditOutlinedIcon />}
                >
                  Edit site
                </Button>
              ) : null}
              {actions.map((action) => (
                <Button
                  key={action}
                  variant={action === "archive" ? "outlined" : "contained"}
                  color={action === "archive" ? "error" : action === "suspend" ? "warning" : "primary"}
                  onClick={() => {
                    setConfirmError(null);
                    setConfirmAction(action);
                  }}
                >
                  {ACTION_LABELS[action]}
                </Button>
              ))}
            </Box>
          </Box>
        </Paper>
      </Box>

      <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 3 }}>
        <Box sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Site information
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Approved fields returned by the Sites API.
          </Typography>
        </Box>
        <Divider />
        <Box
          component="dl"
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
            gap: 0,
            m: 0,
            "& > div": {
              px: { xs: 2, sm: 3 },
              py: 2.25,
              borderBottom: "1px solid",
              borderColor: "divider",
            },
            "& > div:nth-of-type(odd)": { bgcolor: "action.hover" },
          }}
        >
          {fields.map(({ label, value, monospace }) => (
            <Box key={label} sx={{ minWidth: 0 }}>
              <Typography
                component="dt"
                variant="overline"
                color="text.secondary"
                sx={{ lineHeight: 1.5, letterSpacing: 0.7 }}
              >
                {label}
              </Typography>
              <Typography
                component="dd"
                variant="body1"
                sx={{
                  m: 0,
                  mt: 0.5,
                  fontWeight: label === "Code" ? 600 : 400,
                  overflowWrap: "anywhere",
                  ...(monospace ? { fontFamily: "monospace" } : {}),
                }}
              >
                {value}
              </Typography>
            </Box>
          ))}
        </Box>
      </Paper>

      {/* Owner organization — deliberately distinct from the site itself. */}
      <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 3 }}>
        <Box sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Owner organization
          </Typography>
          <Typography variant="body2" color="text.secondary">
            The institutional unit that owns this site. Owner and site are
            distinct records: one unit may own several sites, and a unit may
            own none. The owner&apos;s own type is shown as reported — a child
            site is not assumed to belong to a department.
          </Typography>
        </Box>
        <Divider />
        <Box
          component="dl"
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
            gap: 0,
            m: 0,
            "& > div": {
              px: { xs: 2, sm: 3 },
              py: 2.25,
              borderBottom: "1px solid",
              borderColor: "divider",
            },
            "& > div:nth-of-type(odd)": { bgcolor: "action.hover" },
          }}
        >
          {[
            { label: "Code", value: owner.code ?? "—", monospace: true },
            { label: "Name", value: owner.name ?? `Unit #${owner.unitId}` },
            { label: "Institutional type", value: owner.typeLabel ?? "Unknown" },
            {
              label: "Lifecycle status",
              value: ownerStatusChip ? ownerStatusChip.label : "Unknown",
            },
            {
              label: "Relation",
              value:
                relationLabel(owner.relation) +
                (owner.relation === "child" && owner.rootName
                  ? ` · under ${owner.rootName}`
                  : ""),
            },
          ].map(({ label, value, monospace }) => (
            <Box key={label} sx={{ minWidth: 0 }}>
              <Typography
                component="dt"
                variant="overline"
                color="text.secondary"
                sx={{ lineHeight: 1.5, letterSpacing: 0.7 }}
              >
                {label}
              </Typography>
              <Typography
                component="dd"
                variant="body1"
                sx={{
                  m: 0,
                  mt: 0.5,
                  fontWeight: 600,
                  overflowWrap: "anywhere",
                  ...(monospace ? { fontFamily: "monospace" } : {}),
                }}
              >
                {value}
              </Typography>
            </Box>
          ))}
        </Box>
        {ownerTree.loading ? (
          <Box sx={{ px: { xs: 2, sm: 3 }, py: 1.5, borderTop: 1, borderColor: "divider" }}>
            <Typography variant="caption" color="text.secondary" aria-live="polite">
              Loading owner details…
            </Typography>
          </Box>
        ) : ownerTree.error ? (
          <Box sx={{ px: { xs: 2, sm: 3 }, py: 1.5, borderTop: 1, borderColor: "divider" }}>
            <Typography variant="caption" color="warning.main">
              The organization directory could not be loaded, so the owner is
              shown by id only — no type or relation is guessed.
            </Typography>
          </Box>
        ) : null}
      </Paper>

      {/* Domains: routing records only, never a DNS/TLS claim. */}
      <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 3 }}>
        <Box sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Domains
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Hostnames registered for this site. A domain row is routing data
            only — it does not claim that DNS records or TLS certificates
            exist, and this platform does not provision them.
          </Typography>
        </Box>
        <Divider />
        <Box sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
          {domains.loading ? (
            <Typography variant="body2" color="text.secondary" aria-live="polite">
              Loading domains…
            </Typography>
          ) : domains.error ? (
            <Alert severity="warning" variant="outlined">
              The domain list could not be loaded: {domains.error.message}
              {domains.error.requestId
                ? ` (reference ${domains.error.requestId})`
                : ""}
              . This is a read failure — it does not mean the site has no
              domains.
            </Alert>
          ) : (domains.data?.results ?? []).length === 0 ? (
            <Alert severity="info" variant="outlined">
              No hostnames are registered for this site yet.
            </Alert>
          ) : (
            <Box
              component="ul"
              sx={{
                m: 0,
                pl: 2,
                display: "flex",
                flexDirection: "column",
                gap: 1,
              }}
            >
              {domains.data!.results.map((domain) => (
                <Box
                  component="li"
                  key={domain.id}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    flexWrap: "wrap",
                  }}
                >
                  <Typography
                    variant="body2"
                    sx={{ fontFamily: "monospace", fontWeight: 600 }}
                  >
                    {domain.hostname}
                  </Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    color={domain.is_primary ? "primary" : "default"}
                    label={domain.is_primary ? "Primary" : "Alias"}
                  />
                  <Chip
                    size="small"
                    variant="outlined"
                    color={domain.status === "ACTIVE" ? "success" : "default"}
                    label={domain.status === "ACTIVE" ? "Active" : "Inactive"}
                  />
                  {domain.redirect_to_primary ? (
                    <Typography variant="caption" color="text.secondary">
                      Redirects to the primary domain
                    </Typography>
                  ) : null}
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </Paper>

      {/* Per-site module enablement, honest about planned capabilities. */}
      <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 3 }}>
        <Box sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Modules
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Per-site enablement from the platform module registry. A registry
            row is a capability announcement, not a working feature: a planned
            module cannot run on any site.
          </Typography>
        </Box>
        <Divider />
        <Box sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
          {assignments.loading ? (
            <Typography variant="body2" color="text.secondary" aria-live="polite">
              Loading modules…
            </Typography>
          ) : assignments.error ? (
            <Alert severity="warning" variant="outlined">
              The module assignments could not be loaded: {assignments.error.message}.
              This is a read failure — it does not mean no modules are enabled.
            </Alert>
          ) : (assignments.data?.results ?? []).length === 0 ? (
            <Alert severity="info" variant="outlined">
              No modules are enabled for this site. The registry currently
              lists planned capabilities only, and none is shipped — so no
              module can be enabled yet.
            </Alert>
          ) : (
            <Box
              component="ul"
              sx={{
                m: 0,
                pl: 2,
                display: "flex",
                flexDirection: "column",
                gap: 1,
              }}
            >
              {assignments.data!.results.map((row) => {
                const entry = moduleById.get(row.module);
                return (
                  <Box
                    component="li"
                    key={row.id}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      flexWrap: "wrap",
                    }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {entry ? `${entry.code} — ${entry.name}` : `Module #${row.module}`}
                    </Typography>
                    <Chip
                      size="small"
                      variant="outlined"
                      color={row.is_enabled ? "success" : "default"}
                      label={row.is_enabled ? "Enabled" : "Disabled"}
                    />
                    {entry ? (
                      <Typography variant="caption" color="text.secondary">
                        Registry status: {entry.status.toLowerCase()}
                      </Typography>
                    ) : registry.error ? (
                      <Typography variant="caption" color="warning.main">
                        Module names unavailable (registry read failed)
                      </Typography>
                    ) : null}
                  </Box>
                );
              })}
            </Box>
          )}
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 3 }}>
        <Box
          sx={{
            px: { xs: 2, sm: 3 },
            py: 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 1.5,
          }}
        >
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Settings
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Versioned allowlisted configuration (schema v1). Provenance is
              derived by comparing this document with {baselineLabel}.
            </Typography>
          </Box>
          {showOrigins ? (
            <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
              <Chip size="small" variant="outlined" color="info" label="Inherited" />
              <Chip size="small" variant="filled" color="secondary" label="Override" />
            </Box>
          ) : null}
        </Box>
        {baseline === "failed" ? (
          <Box sx={{ px: { xs: 2, sm: 3 }, pb: 2 }}>
            <Alert severity="warning" variant="outlined">
              The template&apos;s default settings could not be loaded, so
              inherited values cannot be distinguished from overrides right
              now. The values below are the site&apos;s own current settings.
            </Alert>
          </Box>
        ) : null}
        <Divider />
        <Box
          component="dl"
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
            gap: 0,
            m: 0,
            "& > div": {
              px: { xs: 2, sm: 3 },
              py: 2.25,
              borderBottom: "1px solid",
              borderColor: "divider",
            },
            "& > div:nth-of-type(odd)": { bgcolor: "action.hover" },
          }}
        >
          {rows.map((row) => (
            <Box key={row.key} sx={{ minWidth: 0 }}>
              <Typography
                component="dt"
                variant="overline"
                color="text.secondary"
                sx={{ lineHeight: 1.5, letterSpacing: 0.7 }}
              >
                {row.label}
              </Typography>
              <Box component="dd" sx={{ m: 0, mt: 0.5 }}>
                <Typography
                  variant="body1"
                  sx={{
                    overflowWrap: "anywhere",
                    fontWeight: 600,
                    ...(row.monospace ? { fontFamily: "monospace" } : {}),
                  }}
                >
                  {row.value}
                </Typography>
                {showOrigins ? (
                  <Typography
                    variant="caption"
                    sx={{
                      display: "inline-block",
                      mt: 0.75,
                      px: 1,
                      py: 0.25,
                      borderRadius: 1,
                      fontWeight: 600,
                      bgcolor: row.origin === "inherited" ? "info.light" : "secondary.light",
                      color: row.origin === "inherited" ? "info.contrastText" : "secondary.contrastText",
                    }}
                  >
                    {originCaption(row.origin, baselineLabel)}
                  </Typography>
                ) : null}
              </Box>
            </Box>
          ))}
        </Box>
        <Divider />
        <Box sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
          <Alert severity="info" variant="outlined">
            Settings are changed on the Edit site screen through the
            configuration endpoint&apos;s allowlisted merge. Media references are
            stored keys, not uploaded files, and no secrets can be stored in
            site configuration — the platform rejects them server-side.
          </Alert>
        </Box>
      </Paper>

      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmAction ? CONFIRM_COPY[confirmAction].title : ""}
        description={confirmAction ? CONFIRM_COPY[confirmAction].description : ""}
        confirmColor={confirmAction === "archive" ? "error" : "primary"}
        confirmLabel={confirmAction ? ACTION_LABELS[confirmAction] : "Confirm"}
        pending={pending}
        error={confirmError}
        onConfirm={() => {
          if (confirmAction) runLifecycle(confirmAction);
        }}
        onCancel={() => {
          if (!pending) {
            setConfirmAction(null);
            setConfirmError(null);
          }
        }}
      >
        <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
          {site.code} — {site.name} · {siteStatusLabel(site.status)}
        </Typography>
      </ConfirmDialog>
    </Box>
  );
}
