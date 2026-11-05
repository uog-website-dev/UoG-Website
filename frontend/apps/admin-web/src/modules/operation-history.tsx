"use client";

/** Append-only history of central module operations, newest first. */
import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { ApiErrorState, DataTable, FilterBar, LoadingState, Pagination, SelectFilter, useAsync } from "@uog/ui";
import { SITES_PAGE_SIZE } from "@uog/api-client";
import type { PaginatedResponse } from "@uog/types";
import type { TableColumn } from "@uog/ui";

import { getModuleOperation, listModuleOperations } from "@/app/modules/actions";
import { ACTION_LABELS, STATE_LABELS, describeScope } from "@/modules/bulk-contract";
import type { ModuleAction, ModuleActivationSummary, ModuleOperation, ModuleOperationDetail } from "@/modules/bulk-contract";
import { unwrap } from "@/organizations/contract";

const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function OperationHistory({ modules, refreshKey }: { modules: ModuleActivationSummary[]; refreshKey: number }) {
  const [draft, setDraft] = useState({ action: "", module: "" });
  const [filters, setFilters] = useState({ action: "", module: "" });
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const history = useAsync<PaginatedResponse<ModuleOperation>>(
    async () =>
      unwrap(
        await listModuleOperations({
          ...(filters.action ? { action: filters.action as ModuleAction } : {}),
          ...(filters.module ? { module: filters.module } : {}),
          page,
        }),
      ),
    [filters.action, filters.module, page, refreshKey],
  );
  const detail = useAsync<ModuleOperationDetail | null>(
    async () => (openId ? unwrap(await getModuleOperation(openId)) : null),
    [openId],
  );

  const rows = history.data?.results ?? [];
  const columns: TableColumn<ModuleOperation>[] = [
    { field: "created_at", header: "When", render: (row) => when.format(new Date(row.created_at)) },
    { field: "actor", header: "Actor", render: (row) => row.actor.username || `User ${row.actor.id}` },
    {
      field: "action",
      header: "Action",
      render: (row) => (
        <Chip size="small" variant="outlined" color={row.action === "ENABLE" ? "success" : "warning"} label={ACTION_LABELS[row.action].verb} />
      ),
    },
    { field: "modules", header: "Modules", render: (row) => row.module_codes.join(", ") },
    { field: "scope", header: "Scope", render: (row) => describeScope(row.scope) },
    { field: "changes", header: "Changes", align: "right", render: (row) => `${row.change_count} on ${row.changed_site_count} Sites` },
    { field: "blocked", header: "Blocked Sites", align: "right", render: (row) => row.blocked_count },
    {
      field: "reason",
      header: "Reason",
      render: (row) => (
        <Typography variant="body2" sx={{ maxWidth: 260, whiteSpace: "normal" }}>{row.reason || "—"}</Typography>
      ),
    },
  ];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <FilterBar
        label="History filters"
        activeCount={(filters.action ? 1 : 0) + (filters.module ? 1 : 0)}
        resetDisabled={history.loading}
        onApply={() => {
          setFilters({ ...draft });
          setPage(1);
        }}
        onReset={() => {
          setDraft({ action: "", module: "" });
          setFilters({ action: "", module: "" });
          setPage(1);
        }}
      >
        <SelectFilter
          label="Action"
          value={draft.action}
          options={[{ value: "ENABLE", label: "Enable" }, { value: "DISABLE", label: "Disable" }]}
          onChange={(value) => setDraft((previous) => ({ ...previous, action: value }))}
        />
        <SelectFilter
          label="Module"
          value={draft.module}
          options={modules.map((module) => ({ value: module.code, label: module.code }))}
          onChange={(value) => setDraft((previous) => ({ ...previous, module: value }))}
        />
      </FilterBar>

      <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 3 }}>
        <Box sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>Operation history</Typography>
          <Typography variant="body2" color="text.secondary">
            Every committed central module operation. Records cannot be edited or deleted.
          </Typography>
        </Box>
        <Box sx={{ overflowX: "auto" }}>
          <DataTable
            caption="Module operation history"
            columns={columns}
            rows={rows}
            getRowKey={(row) => row.id}
            loading={history.loading}
            error={history.error}
            onRetry={() => history.reload()}
            renderActions={(row) => (
              <Button size="small" onClick={() => setOpenId(row.id)} aria-label={`Details for operation at ${when.format(new Date(row.created_at))}`}>
                Details
              </Button>
            )}
            emptyState={
              <Box sx={{ py: 6, textAlign: "center" }}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>No operations yet</Typography>
                <Typography variant="body2" color="text.secondary">Confirmed operations appear here with every change they made.</Typography>
              </Box>
            }
          />
        </Box>
        {history.data && history.data.count > SITES_PAGE_SIZE ? (
          <Pagination page={page} count={history.data.count} pageSize={SITES_PAGE_SIZE} onPageChange={setPage} label="History pagination" />
        ) : null}
      </Paper>

      <Dialog open={openId !== null} onClose={() => setOpenId(null)} fullWidth maxWidth="md" aria-labelledby="operation-detail-title">
        <DialogTitle id="operation-detail-title">Operation details</DialogTitle>
        <DialogContent dividers>
          {detail.loading ? <LoadingState label="Loading operation…" /> : null}
          {detail.error ? <ApiErrorState error={detail.error} onRetry={() => detail.reload()} /> : null}
          {detail.data ? (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Box component="dl" sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "160px 1fr" }, columnGap: 2, rowGap: 0.75, m: 0, "& dt": { fontWeight: 700 }, "& dd": { m: 0, overflowWrap: "anywhere" } }}>
                <dt>Operation</dt><dd>{detail.data.id}</dd>
                <dt>When</dt><dd>{when.format(new Date(detail.data.created_at))}</dd>
                <dt>Actor</dt><dd>{detail.data.actor.username || `User ${detail.data.actor.id}`}</dd>
                <dt>Action</dt><dd>{ACTION_LABELS[detail.data.action].verb} {detail.data.module_codes.join(", ")}</dd>
                <dt>Scope</dt><dd>{describeScope(detail.data.scope)}</dd>
                <dt>Reason</dt><dd>{detail.data.reason || "—"}</dd>
                <dt>Matched Sites</dt><dd>{detail.data.matched_count}</dd>
                <dt>Already in state</dt><dd>{detail.data.unchanged_count}</dd>
                <dt>Blocked Sites</dt><dd>{detail.data.blocked_count}</dd>
                <dt>Correlation ID</dt><dd>{detail.data.request_id ?? "—"}</dd>
              </Box>
              {detail.data.changes.length === 0 ? (
                <Typography variant="body2">This operation changed nothing.</Typography>
              ) : (
                <Table size="small" aria-label="Changes made by this operation">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>Site</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Module</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Before</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>After</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {detail.data.changes.map((change) => (
                      <TableRow key={`${change.site}-${change.module}`}>
                        <TableCell>{change.site_name} <Typography component="span" variant="caption" color="text.secondary">({change.site_code})</Typography></TableCell>
                        <TableCell sx={{ fontFamily: "monospace" }}>{change.module}</TableCell>
                        <TableCell>{STATE_LABELS[change.previous_state]}</TableCell>
                        <TableCell>{STATE_LABELS[change.new_state]}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenId(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
