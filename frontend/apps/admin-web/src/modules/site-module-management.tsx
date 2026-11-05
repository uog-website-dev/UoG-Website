"use client";

/**
 * Site module management: filter Sites, choose a scope and modules, then
 * preview and confirm one bulk operation.
 *
 * Selecting rows only ever targets the Sites visibly checked. Targeting every
 * Site that matches the filters, across pages, is a separate explicit scope.
 * Eligibility, counts and the final result always come from the backend.
 */
import { useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormLabel from "@mui/material/FormLabel";
import InputLabel from "@mui/material/InputLabel";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import OutlinedInput from "@mui/material/OutlinedInput";
import Paper from "@mui/material/Paper";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Select from "@mui/material/Select";
import Skeleton from "@mui/material/Skeleton";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { ApiErrorState, EmptyState, FilterBar, Pagination, SelectFilter, TextFilter, useAsync } from "@uog/ui";
import { SITES_PAGE_SIZE } from "@uog/api-client";
import type { OrganizationHierarchy, PaginatedResponse } from "@uog/types";

import { listSiteModuleActivation } from "@/app/modules/actions";
import { getOrganizationTree } from "@/app/organizations/actions";
import { BulkOperationDialog } from "@/modules/bulk-operation-dialog";
import {
  ACTIVATION_OPTIONS,
  SITE_STATUS_OPTIONS,
  STATE_LABELS,
  cleanFilters,
  describeScope,
  hasFilters,
  implementationLabel,
  organizationOptions,
} from "@/modules/bulk-contract";
import type {
  ActivationState,
  ApplyResult,
  ModuleAction,
  ModuleActivationSummary,
  OperationScope,
  SiteActivationRow,
  SiteFilters,
} from "@/modules/bulk-contract";
import { unwrap } from "@/organizations/contract";

type ScopeMode = "SELECTED" | "FILTER" | "ALL" | "ORGANIZATION";

interface Draft {
  search: string;
  status: string;
  organization: string;
  include_descendants: boolean;
  module: string;
  activation: string;
}

const EMPTY_DRAFT: Draft = { search: "", status: "", organization: "", include_descendants: false, module: "", activation: "" };

function filtersFrom(draft: Draft): SiteFilters {
  return cleanFilters({
    search: draft.search,
    status: (draft.status || undefined) as SiteFilters["status"],
    organization: draft.organization ? Number(draft.organization) : undefined,
    include_descendants: draft.include_descendants,
    module: draft.module || undefined,
    activation: (draft.activation || undefined) as ActivationState | undefined,
  });
}

const STATE_CHIP: Record<ActivationState, { color: "success" | "default" | "warning"; variant: "filled" | "outlined" }> = {
  ENABLED: { color: "success", variant: "filled" },
  DISABLED: { color: "warning", variant: "outlined" },
  NOT_ASSIGNED: { color: "default", variant: "outlined" },
};

export function SiteModuleManagement({
  modules,
  onApplied,
  onShowHistory,
}: {
  modules: ModuleActivationSummary[];
  onApplied: (result: ApplyResult) => void;
  onShowHistory: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [applied, setApplied] = useState<SiteFilters>({});
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Map<number, SiteActivationRow>>(new Map());
  const [scopeMode, setScopeMode] = useState<ScopeMode>("SELECTED");
  const [scopeOrganization, setScopeOrganization] = useState("");
  const [scopeDescendants, setScopeDescendants] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [dialog, setDialog] = useState<{ action: ModuleAction; scope: OperationScope; scopeLabel: string } | null>(null);

  const matrix = useAsync<PaginatedResponse<SiteActivationRow>>(
    async () => unwrap(await listSiteModuleActivation({ ...applied, page })),
    [JSON.stringify(applied), page],
  );
  const organizations = useAsync<OrganizationHierarchy>(async () => unwrap(await getOrganizationTree()), []);
  const orgOptions = useMemo(() => organizationOptions(organizations.data?.results ?? []), [organizations.data]);
  const orgName = (id: number) => organizations.data?.results.find((unit) => unit.id === id)?.name;

  const rows = matrix.data?.results ?? [];
  const total = matrix.data?.count ?? 0;
  const moduleColumns = modules.filter((module) => module.status !== "PLANNED").map((module) => module.code);
  const pageSelected = rows.filter((row) => selected.has(row.id)).length;
  const allPageSelected = rows.length > 0 && pageSelected === rows.length;
  const filtersActive = hasFilters(applied);

  const applyFilters = (next: SiteFilters) => {
    setApplied(next);
    setPage(1);
    setSelected(new Map());
    if (scopeMode === "FILTER" && !hasFilters(next)) setScopeMode("SELECTED");
  };

  const toggle = (row: SiteActivationRow) =>
    setSelected((previous) => {
      const next = new Map(previous);
      if (next.has(row.id)) next.delete(row.id);
      else next.set(row.id, row);
      return next;
    });

  const togglePage = () =>
    setSelected((previous) => {
      const next = new Map(previous);
      if (allPageSelected) rows.forEach((row) => next.delete(row.id));
      else rows.forEach((row) => next.set(row.id, row));
      return next;
    });

  const scope = ((): { scope: OperationScope; label: string } | null => {
    switch (scopeMode) {
      case "SELECTED": {
        const ids = [...selected.keys()].sort((a, b) => a - b);
        if (ids.length === 0) return null;
        const value: OperationScope = ids.length === 1 ? { type: "SITE", site_ids: ids } : { type: "SELECTED", site_ids: ids };
        return { scope: value, label: ids.length === 1 ? `${selected.get(ids[0])?.name ?? "1 Site"}` : `${ids.length} selected Sites` };
      }
      case "FILTER":
        return { scope: { type: "FILTER", filters: applied }, label: `All ${total} Sites matching the filters` };
      case "ALL":
        return { scope: { type: "ALL" }, label: "All Sites" };
      case "ORGANIZATION": {
        if (!scopeOrganization) return null;
        const value: OperationScope = { type: "ORGANIZATION", organization: Number(scopeOrganization), include_descendants: scopeDescendants };
        return { scope: value, label: describeScope(value, orgName) };
      }
    }
  })();

  const canPreview = scope !== null && chosen.length > 0;
  const open = (action: ModuleAction) => {
    if (!scope) return;
    setDialog({ action, scope: scope.scope, scopeLabel: scope.label });
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <FilterBar
        label="Site filters"
        activeCount={Object.keys(applied).length}
        resetDisabled={matrix.loading}
        onApply={() => applyFilters(filtersFrom(draft))}
        onReset={() => {
          setDraft(EMPTY_DRAFT);
          applyFilters({});
        }}
      >
        <TextFilter
          label="Site"
          value={draft.search}
          onChange={(value) => setDraft((previous) => ({ ...previous, search: value }))}
          placeholder="Code or name"
        />
        <SelectFilter
          label="Organization"
          value={draft.organization}
          options={orgOptions.map((option) => ({ value: String(option.value), label: `${"\u2003".repeat(option.depth)}${option.label}` }))}
          onChange={(value) => setDraft((previous) => ({ ...previous, organization: value, include_descendants: value ? previous.include_descendants : false }))}
          allLabel="Any"
        />
        <FormControlLabel
          control={
            <Switch
              checked={draft.include_descendants}
              disabled={!draft.organization}
              onChange={(event) => setDraft((previous) => ({ ...previous, include_descendants: event.target.checked }))}
            />
          }
          label="Include descendants"
        />
        <SelectFilter
          label="Site status"
          value={draft.status}
          options={SITE_STATUS_OPTIONS}
          onChange={(value) => setDraft((previous) => ({ ...previous, status: value }))}
          allLabel="Any"
        />
        <SelectFilter
          label="Module"
          value={draft.module}
          options={modules.map((module) => ({ value: module.code, label: module.code }))}
          onChange={(value) => setDraft((previous) => ({ ...previous, module: value, activation: value ? previous.activation : "" }))}
          allLabel="Any"
        />
        <SelectFilter
          label="Activation"
          value={draft.activation}
          options={ACTIVATION_OPTIONS}
          disabled={!draft.module}
          onChange={(value) => setDraft((previous) => ({ ...previous, activation: value }))}
          allLabel="Any"
        />
      </FilterBar>

      <Paper variant="outlined" sx={{ borderRadius: 3, p: { xs: 2, sm: 3 }, display: "flex", flexDirection: "column", gap: 2 }} component="section" aria-labelledby="bulk-toolbar-title">
        <Typography id="bulk-toolbar-title" variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>
          Change modules
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 3, alignItems: "flex-start" }}>
          <FormControl size="small" sx={{ minWidth: 240, maxWidth: "100%" }}>
            <InputLabel id="bulk-modules-label">Modules</InputLabel>
            <Select
              labelId="bulk-modules-label"
              id="bulk-modules"
              multiple
              value={chosen}
              onChange={(event) => setChosen(typeof event.target.value === "string" ? event.target.value.split(",") : event.target.value)}
              input={<OutlinedInput label="Modules" />}
              renderValue={(value) => value.join(", ")}
            >
              {modules.map((module) => (
                <MenuItem key={module.code} value={module.code}>
                  <Checkbox checked={chosen.includes(module.code)} size="small" />
                  <ListItemText primary={`${module.code} · ${module.name}`} secondary={implementationLabel(module.implementation_status).label} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl component="fieldset" sx={{ minWidth: 0 }}>
            <FormLabel component="legend" sx={{ fontSize: 13, fontWeight: 600 }}>Apply to</FormLabel>
            <RadioGroup row value={scopeMode} onChange={(event) => setScopeMode(event.target.value as ScopeMode)}>
              <FormControlLabel value="SELECTED" control={<Radio size="small" />} label={`Selected Sites (${selected.size})`} />
              <FormControlLabel value="FILTER" control={<Radio size="small" />} disabled={!filtersActive} label={`All matching filters (${filtersActive ? total : 0})`} />
              <FormControlLabel value="ALL" control={<Radio size="small" />} label="All Sites" />
              <FormControlLabel value="ORGANIZATION" control={<Radio size="small" />} label="An Organization" />
            </RadioGroup>
            {scopeMode === "ORGANIZATION" ? (
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, alignItems: "center", mt: 1 }}>
                <TextField
                  select
                  size="small"
                  label="Target Organization"
                  value={scopeOrganization}
                  onChange={(event) => setScopeOrganization(event.target.value)}
                  sx={{ minWidth: 240 }}
                  slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                >
                  <option value="">Choose an Organization</option>
                  {orgOptions.map((option) => (
                    <option key={option.value} value={String(option.value)}>
                      {`${"\u00a0\u00a0".repeat(option.depth)}${option.label}`}
                    </option>
                  ))}
                </TextField>
                <FormControlLabel
                  control={<Switch checked={scopeDescendants} onChange={(event) => setScopeDescendants(event.target.checked)} />}
                  label="Include descendant Organizations"
                />
              </Box>
            ) : null}
          </FormControl>
        </Box>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, alignItems: "center" }}>
          <Button variant="contained" disabled={!canPreview} onClick={() => open("ENABLE")}>
            Preview enable
          </Button>
          <Button variant="outlined" color="warning" disabled={!canPreview} onClick={() => open("DISABLE")}>
            Preview disable
          </Button>
          <Typography variant="body2" color="text.secondary" role="status">
            {chosen.length === 0
              ? "Choose at least one module."
              : scope === null
                ? scopeMode === "SELECTED" ? "Select Sites in the table, or choose another scope." : "Choose an Organization."
                : `${chosen.join(", ")} on ${scope.label}. Nothing changes until you confirm the preview.`}
          </Typography>
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 3 }}>
        <Box sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>
            Sites
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Module activation per Site, read from the backend.
          </Typography>
        </Box>

        {allPageSelected && total > rows.length && scopeMode !== "FILTER" ? (
          <Alert severity="info" sx={{ borderRadius: 0 }} action={
            filtersActive ? (
              <Button color="inherit" size="small" onClick={() => setScopeMode("FILTER")}>
                Use all {total} matching Sites
              </Button>
            ) : (
              <Button color="inherit" size="small" onClick={() => setScopeMode("ALL")}>
                Use all {total} Sites
              </Button>
            )
          }>
            All {rows.length} Sites on this page are selected. Sites on other pages are not.
          </Alert>
        ) : null}
        {scopeMode === "FILTER" ? (
          <Alert severity="warning" sx={{ borderRadius: 0 }} action={
            <Button color="inherit" size="small" onClick={() => setScopeMode("SELECTED")}>Use selection instead</Button>
          }>
            The operation targets all {total} Sites matching the filters, including Sites on other pages.
          </Alert>
        ) : null}

        {matrix.error ? (
          <ApiErrorState error={matrix.error} onRetry={() => matrix.reload()} />
        ) : (
          <TableContainer sx={{ overflowX: "auto" }}>
            <Table size="small" aria-label="Sites and module activation">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={allPageSelected}
                      indeterminate={pageSelected > 0 && !allPageSelected}
                      disabled={rows.length === 0}
                      onChange={togglePage}
                      slotProps={{ input: { "aria-label": "Select every Site on this page" } }}
                    />
                  </TableCell>
                  <TableCell scope="col" sx={{ fontWeight: 700 }}>Site</TableCell>
                  <TableCell scope="col" sx={{ fontWeight: 700 }}>Organization</TableCell>
                  <TableCell scope="col" sx={{ fontWeight: 700 }}>Site status</TableCell>
                  {moduleColumns.map((code) => (
                    <TableCell key={code} scope="col" sx={{ fontWeight: 700, fontFamily: "monospace" }}>{code}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {matrix.loading
                  ? Array.from({ length: 4 }).map((_, index) => (
                      <TableRow key={`loading-${index}`}>
                        {Array.from({ length: 4 + moduleColumns.length }).map((__, cell) => (
                          <TableCell key={cell}><Skeleton variant="text" width={cell === 0 ? 20 : 90} /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  : rows.map((row) => (
                      <TableRow key={row.id} hover selected={selected.has(row.id)}>
                        <TableCell padding="checkbox">
                          <Checkbox
                            size="small"
                            checked={selected.has(row.id)}
                            onChange={() => toggle(row)}
                            slotProps={{ input: { "aria-label": `Select ${row.name}` } }}
                          />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.name}</Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>{row.code}</Typography>
                        </TableCell>
                        <TableCell>{row.organization.name}</TableCell>
                        <TableCell>
                          <Chip size="small" variant="outlined" label={row.status.charAt(0) + row.status.slice(1).toLowerCase()} color={row.status === "ACTIVE" ? "success" : row.status === "ARCHIVED" ? "default" : "warning"} />
                        </TableCell>
                        {moduleColumns.map((code) => {
                          const state: ActivationState = row.modules[code] ?? "NOT_ASSIGNED";
                          return (
                            <TableCell key={code}>
                              <Chip size="small" color={STATE_CHIP[state].color} variant={STATE_CHIP[state].variant} label={STATE_LABELS[state]} />
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
            {!matrix.loading && rows.length === 0 ? (
              <Box sx={{ borderTop: 1, borderColor: "divider" }}>
                <EmptyState
                  title={filtersActive ? "No Sites match these filters" : "No Sites yet"}
                  description={filtersActive ? "Change or reset the filters." : "Create a Site before enabling modules."}
                />
              </Box>
            ) : null}
          </TableContainer>
        )}
        {total > SITES_PAGE_SIZE ? (
          <Pagination page={page} count={total} pageSize={SITES_PAGE_SIZE} onPageChange={setPage} label="Site pagination" />
        ) : null}
      </Paper>

      {dialog ? (
        <BulkOperationDialog
          action={dialog.action}
          modules={chosen}
          scope={dialog.scope}
          scopeLabel={dialog.scopeLabel}
          onClose={() => setDialog(null)}
          onShowHistory={() => {
            setDialog(null);
            onShowHistory();
          }}
          onApplied={(result) => {
            setSelected(new Map());
            matrix.reload();
            onApplied(result);
          }}
        />
      ) : null}
    </Box>
  );
}
