"use client";

/**
 * Platform module registry: the catalogue of capabilities and where they run.
 *
 * Three separate facts are shown per module and never merged:
 *   - implementation status (Available, Planned, Deprecated, Implemented
 *     but disabled), from the registry plus the shipped implementation list;
 *   - platform availability, the global switch;
 *   - Site activation, counted from SiteModule rows by the backend.
 *
 * Reads go through server actions, so the Keycloak access token stays
 * server-side. The platform switch uses a conditional backend update;
 * enabling a module for Sites happens on the Site modules tab.
 */
import { useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Switch from "@mui/material/Switch";
import {
  DataTable,
  FilterBar,
  Pagination,
  SelectFilter,
  TextFilter,
  useAsync,
} from "@uog/ui";
import { SITES_PAGE_SIZE } from "@uog/api-client";
import type { PaginatedResponse, PlatformModule } from "@uog/types";
import type { TableColumn } from "@uog/ui";

import { listModuleActivationSummary, setPlatformModuleAvailability } from "@/app/modules/actions";
import { listPlatformModules } from "@/app/sites/actions";
import { implementationLabel } from "@/modules/bulk-contract";
import type { ImplementationStatus, ModuleActivationSummary } from "@/modules/bulk-contract";
import { unwrap } from "@/organizations/contract";
import {
  MODULE_STATUS_OPTIONS,
  availabilityMessage,
  moduleSchemaProperties,
} from "@/modules/validation";

interface Filters {
  search: string;
  status: string;
}

/** Without the summary (e.g. it failed to load) derive what the row alone says. */
function fallbackImplementation(module: PlatformModule): ImplementationStatus {
  if (module.status === "PLANNED") return "PLANNED";
  if (module.status === "DEPRECATED") return "DEPRECATED";
  return module.is_enabled ? "AVAILABLE" : "IMPLEMENTED_DISABLED";
}

export function ModuleRegistry({ refreshKey = 0, onChanged }: { refreshKey?: number; onChanged?: () => void } = {}) {
  const [filters, setFilters] = useState<Filters>({ search: "", status: "" });
  const [draft, setDraft] = useState<Filters>({ search: "", status: "" });
  const [page, setPage] = useState(1);
  const [details, setDetails] = useState<PlatformModule | null>(null);
  const [pending, setPending] = useState<PlatformModule | null>(null);
  const [saving, setSaving] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const changeAvailability = async () => {
    if (!pending || saving) return;
    setSaving(true);
    setWriteError(null);
    try {
      const updated = unwrap(await setPlatformModuleAvailability(pending.id, !pending.is_enabled, pending.updated_at));
      setNotice(`${updated.name} ${updated.is_enabled ? "enabled" : "disabled"} platform-wide.`);
      setPending(null);
      setDetails(null);
      registry.reload();
      summary.reload();
      onChanged?.();
    } catch (cause) {
      setWriteError(cause instanceof Error ? cause.message : "The module could not be changed.");
    } finally {
      setSaving(false);
    }
  };

  const registry = useAsync<PaginatedResponse<PlatformModule>>(
    async () =>
      unwrap(
        await listPlatformModules({
          ...(filters.search ? { search: filters.search } : {}),
          ...(filters.status
            ? { status: filters.status as "PLANNED" | "IMPLEMENTED" | "DEPRECATED" }
            : {}),
          page,
        }),
      ),
    [filters.search, filters.status, page, refreshKey],
  );
  const summary = useAsync<ModuleActivationSummary[]>(
    async () => unwrap(await listModuleActivationSummary()),
    [refreshKey],
  );
  const byCode = useMemo(
    () => new Map((summary.data ?? []).map((row) => [row.code, row])),
    [summary.data],
  );

  const activeCount =
    (filters.search ? 1 : 0) + (filters.status ? 1 : 0);
  const modules = registry.data?.results ?? [];
  const filtered = activeCount > 0;
  const count = (value: number | undefined) =>
    summary.loading ? "…" : value === undefined ? "—" : String(value);

  const columns: TableColumn<PlatformModule>[] = [
    {
      field: "code",
      header: "Code",
      render: (row) => (
        <Typography sx={{ fontFamily: "monospace", fontWeight: 700 }}>
          {row.code}
        </Typography>
      ),
    },
    { field: "name", header: "Name", render: (row) => row.name },
    {
      field: "status",
      header: "Status",
      render: (row) => {
        const chip = implementationLabel(
          byCode.get(row.code)?.implementation_status ?? fallbackImplementation(row),
        );
        return <Chip size="small" variant="outlined" color={chip.color} label={chip.label} />;
      },
    },
    {
      field: "is_enabled",
      header: "Platform availability",
      render: (row) => (
        <Box sx={{ display: "flex", alignItems: "center" }}>
          <Switch
            checked={row.is_enabled}
            disabled={saving || (!row.is_enabled && (row.status !== "IMPLEMENTED" || !byCode.get(row.code)?.is_shipped))}
            inputProps={{ "aria-label": `Platform availability for ${row.code}` }}
            onChange={() => { setPending(row); setWriteError(null); setNotice(null); }}
          />
          <Typography variant="body2">{row.is_enabled ? "On" : "Off"}</Typography>
        </Box>
      ),
    },
    {
      field: "enabled_sites",
      header: "Sites enabled",
      align: "right",
      render: (row) => count(byCode.get(row.code)?.enabled_sites),
    },
    {
      field: "eligible_sites",
      header: "Eligible Sites",
      align: "right",
      render: (row) => count(byCode.get(row.code)?.eligible_sites),
    },
    {
      field: "requires",
      header: "Depends on",
      render: (row) => {
        const requires = byCode.get(row.code)?.requires;
        if (!requires) return count(undefined);
        return requires.length === 0 ? "None" : requires.join(", ");
      },
    },
    {
      field: "description",
      header: "Description",
      render: (row) => (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ maxWidth: 320, whiteSpace: "normal" }}
        >
          {row.description || "—"}
        </Typography>
      ),
    },
  ];

  const detailSummary = details ? byCode.get(details.code) : undefined;
  const detailProperties = details ? moduleSchemaProperties(details) : null;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Alert severity="info" variant="outlined">
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          Implementation, platform availability and Site activation are separate.
        </Typography>
        <Typography variant="body2">
          <strong>Available</strong> means implemented, shipped and switched
          on platform-wide, so Sites may enable it. <strong>Planned</strong>{" "}
          modules are registered but not implemented and cannot be enabled
          anywhere. <strong>Deprecated</strong> modules cannot be newly
          enabled. <strong>Implemented but disabled</strong> modules wait for
          the platform switch. Use Platform availability below to enable or
          disable a shipped module. Site activation is managed on the Site modules tab.
        </Typography>
      </Alert>

      {notice ? <Alert severity="success">{notice}</Alert> : null}

      <Dialog open={pending !== null} onClose={() => { if (!saving) setPending(null); }} aria-labelledby="module-switch-title">
        <DialogTitle id="module-switch-title">{pending?.is_enabled ? "Disable" : "Enable"} {pending?.name} platform-wide?</DialogTitle>
        <DialogContent>
          <Typography>
            {pending?.is_enabled
              ? "This makes the module unavailable across all Sites. Existing Site assignments, settings and content are preserved."
              : "This allows Sites to activate the module. Existing Site assignments become effective again; unassigned Sites remain unchanged."}
          </Typography>
          {writeError ? <Alert severity="error" sx={{ mt: 2 }}>{writeError}</Alert> : null}
        </DialogContent>
        <DialogActions>
          <Button disabled={saving} onClick={() => setPending(null)}>Cancel</Button>
          <Button disabled={saving} onClick={() => void changeAvailability()}>{saving ? "Saving…" : pending?.is_enabled ? "Disable module" : "Enable module"}</Button>
        </DialogActions>
      </Dialog>

      {summary.error ? (
        <Alert
          severity="warning"
          action={<Button color="inherit" size="small" onClick={() => summary.reload()}>Retry</Button>}
        >
          Site counts and dependencies could not be loaded. {summary.error.message}
        </Alert>
      ) : null}

      <FilterBar
        label="Module filters"
        activeCount={activeCount}
        resetDisabled={registry.loading}
        onApply={() => {
          setFilters({ ...draft });
          setPage(1);
        }}
        onReset={() => {
          setDraft({ search: "", status: "" });
          setFilters({ search: "", status: "" });
          setPage(1);
        }}
      >
        <TextFilter
          label="Search"
          value={draft.search}
          onChange={(value) => setDraft((previous) => ({ ...previous, search: value }))}
          placeholder="Posts, menus…"
          hint="Name or code substring."
        />
        <SelectFilter
          label="Registry status"
          value={draft.status}
          options={MODULE_STATUS_OPTIONS.filter((option) => option.value !== "").map(
            (option) => ({ value: option.value as string, label: option.label }),
          )}
          onChange={(value) => setDraft((previous) => ({ ...previous, status: value }))}
          includeAll
          allLabel="All"
        />
      </FilterBar>

      <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 3 }}>
        <Box sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>
            Registered capabilities
          </Typography>
          <Typography variant="body2" color="text.secondary">
            The platform module registry as the API reports it, with how many
            Sites run each module and how many could.
          </Typography>
        </Box>
        <Box sx={{ overflowX: "auto" }}>
          <DataTable
            caption="Platform module registry"
            columns={columns}
            rows={modules}
            getRowKey={(row) => row.id}
            loading={registry.loading}
            error={registry.error}
            onRetry={() => registry.reload()}
            renderActions={(row) => (
              <Button
                size="small"
                onClick={() => setDetails(row)}
                aria-label={`Details for ${row.code}`}
              >
                Details
              </Button>
            )}
            emptyState={
              filtered ? (
                <Box sx={{ display: "grid", justifyItems: "center", gap: 1.5, py: 6, px: 3, textAlign: "center" }}>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    No modules match these filters
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Clear the filters to see the whole registry.
                  </Typography>
                  <Button
                    variant="outlined"
                    onClick={() => {
                      setDraft({ search: "", status: "" });
                      setFilters({ search: "", status: "" });
                      setPage(1);
                    }}
                  >
                    Clear filters
                  </Button>
                </Box>
              ) : (
                <Box sx={{ display: "grid", justifyItems: "center", gap: 1.5, py: 6, px: 3, textAlign: "center" }}>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    No modules registered
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    The platform module registry is empty, so no capability can
                    be enabled on any site.
                  </Typography>
                </Box>
              )
            }
          />
        </Box>
        {registry.data && registry.data.count > modules.length ? (
          <Pagination
            page={page}
            count={registry.data.count}
            pageSize={SITES_PAGE_SIZE}
            onPageChange={(next) => setPage(next)}
            label="Module registry pagination"
          />
        ) : null}
      </Paper>

      <Dialog open={details !== null} onClose={() => setDetails(null)} fullWidth maxWidth="sm" aria-labelledby="module-details-title">
        {details ? (
          <>
            <DialogTitle id="module-details-title">
              {details.name}{" "}
              <Box component="span" sx={{ fontFamily: "monospace", color: "text.secondary", fontSize: "0.9em" }}>
                {details.code}
              </Box>
            </DialogTitle>
            <DialogContent dividers>
              <Box component="dl" sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "180px 1fr" }, columnGap: 2, rowGap: 1, m: 0, "& dt": { fontWeight: 700 }, "& dd": { m: 0 } }}>
                <dt>Status</dt>
                <dd>{implementationLabel(detailSummary?.implementation_status ?? fallbackImplementation(details)).label}</dd>
                <dt>Registry status</dt>
                <dd>{details.status}</dd>
                <dt>Shipped in this deployment</dt>
                <dd>{detailSummary ? (detailSummary.is_shipped ? "Yes" : "No") : "—"}</dd>
                <dt>Platform availability</dt>
                <dd>{details.is_enabled ? "On" : "Off"}</dd>
                <dt>Sites enabled</dt>
                <dd>{detailSummary ? `${detailSummary.enabled_sites} of ${detailSummary.total_sites}` : "—"}</dd>
                <dt>Sites with it turned off</dt>
                <dd>{detailSummary ? detailSummary.disabled_sites : "—"}</dd>
                <dt>Eligible Sites</dt>
                <dd>{detailSummary ? detailSummary.eligible_sites : "—"}</dd>
                <dt>Depends on</dt>
                <dd>{detailSummary ? detailSummary.requires.join(", ") || "None" : "—"}</dd>
                <dt>Required by</dt>
                <dd>{detailSummary ? detailSummary.required_by.join(", ") || "None" : "—"}</dd>
                <dt>Site settings</dt>
                <dd>
                  {detailProperties === null
                    ? "Schema unapproved"
                    : detailProperties.length === 0
                      ? "None"
                      : detailProperties.map((property) => `${property.label}${property.required ? " (required)" : ""}`).join(", ")}
                </dd>
                <dt>Description</dt>
                <dd>{details.description || "—"}</dd>
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                {availabilityMessage(details)}
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDetails(null)}>Close</Button>
            </DialogActions>
          </>
        ) : null}
      </Dialog>
    </Box>
  );
}
