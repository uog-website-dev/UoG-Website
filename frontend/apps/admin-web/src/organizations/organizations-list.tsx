"use client";

/**
 * Organization list: discovery filters, pagination, and the approved
 * deactivate/archive lifecycle actions.
 *
 * Reads go through `listOrganizations` (a server action) so the access token
 * stays server-side; `useAsync` owns loading/empty/error rendering through the
 * shared states. Every lifecycle change is confirmed first, then executed
 * against the *current* strong ETag fetched immediately before the call, so a
 * stale row can never silently overwrite a newer one — a 412 is surfaced as a
 * concurrency message instead.
 *
 * The applied filters, page and sort live in the URL query string (see
 * ./list-query), so any view of the list is shareable and survives reload:
 * every Apply/Reset/page/sort change writes the URL, and the first render
 * hydrates its state from it. URL values that do not match the discovery
 * contract are dropped rather than sent — the backend rejects invalid
 * parameters with 400.
 *
 * The backend does not expose a reactivation endpoint: the lifecycle is
 * forward-only (ACTIVE -> INACTIVE -> ARCHIVED). The UI therefore never offers
 * an "activate" action, because offering one would present a control that no
 * API supports. Deactivate/archive on the root or on a unit with active
 * descendants are refused by the database rules and shown as errors.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import AddIcon from "@mui/icons-material/Add";
import AccountTreeRoundedIcon from "@mui/icons-material/AccountTreeRounded";
import BusinessRoundedIcon from "@mui/icons-material/BusinessRounded";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ConfirmDialog,
  DataTable,
  FilterBar,
  Pagination,
  SelectFilter,
  TextFilter,
  useAsync,
  useToast,
} from "@uog/ui";
import type { FilterOption, SortState } from "@uog/ui";
import type {
  Organization,
  OrganizationListQuery,
  OrganizationStatus,
  PaginatedResponse,
} from "@uog/types";

import {
  archiveOrganization,
  deactivateOrganization,
  getOrganization,
  getOrganizationTree,
  listOrganizations,
} from "@/app/organizations/actions";
import { deserializeApiError, unwrap } from "@/organizations/contract";
import {
  draftFromQuery,
  draftToQuery,
  emptyDraft,
  orderingFromSort,
  parseListQuery,
  sortFromOrdering,
} from "@/organizations/list-query";
import type { ApiError } from "@uog/api-client";
import {
  ORGANIZATION_STATUS_OPTIONS,
  ORGANIZATION_TYPE_OPTIONS,
  organizationTypeLabel,
} from "@/organizations/validation";

type LifecycleAction = "deactivate" | "archive";

const PAGE_SIZE = 20;

function sameQuery(
  left: OrganizationListQuery,
  right: OrganizationListQuery,
): boolean {
  return (
    left.search === right.search &&
    left.name === right.name &&
    left.code === right.code &&
    left.type === right.type &&
    left.status === right.status &&
    left.parent === right.parent &&
    left.page === right.page &&
    left.ordering === right.ordering
  );
}

/** Status chip colours, kept consistent across every admin screen. */
function statusChip(status: OrganizationStatus) {
  switch (status) {
    case "ACTIVE":
      return { color: "success" as const, label: "Active" };
    case "INACTIVE":
      return { color: "warning" as const, label: "Inactive" };
    case "ARCHIVED":
      return { color: "default" as const, label: "Archived" };
  }
}

export function OrganizationsList() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();

  // The URL is the shareable record of what is being viewed: hydrate from it
  // on first render, keep the applied state locally, and write every change
  // back so copy/paste, reload and back/forward all behave predictably.
  const [applied, setApplied] = useState<OrganizationListQuery>(() => {
    const { page: _page, ordering: _ordering, ...filters } = parseListQuery(searchParams);
    return filters;
  });
  const [page, setPage] = useState(() => parseListQuery(searchParams).page ?? 1);
  const [sort, setSort] = useState<SortState>(() =>
    sortFromOrdering(searchParams.get("ordering")),
  );
  // Draft filter values, applied only on Apply/Reset so the backend is not
  // queried per keystroke.
  const [draft, setDraft] = useState(() => draftFromQuery(parseListQuery(searchParams)));
  const urlQuery = searchParams.toString();

  // Keep browser back/forward navigation in sync with the controls and the
  // server query, not just the initial page load.
  useEffect(() => {
    const parsed = parseListQuery(new URLSearchParams(urlQuery));
    const { page: nextPage, ordering, ...filters } = parsed;
    setApplied((current) => (sameQuery(current, filters) ? current : filters));
    setPage((current) => (current === (nextPage ?? 1) ? current : nextPage ?? 1));
    const nextSort = sortFromOrdering(ordering);
    setSort((current) =>
      current.field === nextSort.field && current.direction === nextSort.direction
        ? current
        : nextSort,
    );
    const nextDraft = draftFromQuery(filters);
    setDraft((current) =>
      current.search === nextDraft.search &&
      current.name === nextDraft.name &&
      current.code === nextDraft.code &&
      current.type === nextDraft.type &&
      current.status === nextDraft.status &&
      current.parent === nextDraft.parent
        ? current
        : nextDraft,
    );
  }, [urlQuery]);

  /** Write the current view state into the URL (undefined deletes a key). */
  const writeUrl = useCallback(
    (patch: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === "") params.delete(key);
        else params.set(key, value);
      }
      const queryString = params.toString();
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router, searchParams],
  );

  const query = useMemo<OrganizationListQuery>(
    () => ({
      ...applied,
      page,
      ordering: orderingFromSort(sort),
    }),
    [applied, page, sort],
  );

  const organizations = useAsync<PaginatedResponse<Organization>>(
    async () => unwrap(await listOrganizations(query)),
    [query],
    { isEmpty: (data) => data.count === 0 },
  );

  const [pending, setPending] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<{
    organization: Organization;
    action: LifecycleAction;
  } | null>(null);
  const [confirmError, setConfirmError] = useState<ApiError | null>(null);

  const applyFilters = useCallback(() => {
    const code = draft.code.trim();
    if (code && !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(code)) return;
    const next = draftToQuery(draft);
    setApplied(next);
    setPage(1);
    writeUrl({
      search: next.search,
      name: next.name,
      code: next.code,
      type: next.type,
      status: next.status,
      parent: next.parent === undefined ? undefined : String(next.parent),
      page: undefined, // applying filters returns to the first page
    });
  }, [draft, writeUrl]);

  const resetFilters = useCallback(() => {
    setDraft(emptyDraft());
    setApplied({});
    setPage(1);
    writeUrl({
      search: undefined,
      name: undefined,
      code: undefined,
      type: undefined,
      status: undefined,
      parent: undefined,
      page: undefined,
    });
  }, [writeUrl]);

  const changePage = useCallback(
    (nextPage: number) => {
      setPage(nextPage);
      writeUrl({ page: nextPage > 1 ? String(nextPage) : undefined });
    },
    [writeUrl],
  );

  const changeSort = useCallback(
    (nextSort: SortState) => {
      setSort(nextSort);
      setPage(1);
      writeUrl({ ordering: orderingFromSort(nextSort), page: undefined });
    },
    [writeUrl],
  );

  const activeFilterCount = useMemo(
    () =>
      Object.values(applied).filter(
        (value) => value !== undefined && value !== "",
      ).length,
    [applied],
  );
  const invalidCode = Boolean(
    draft.code.trim() && !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(draft.code.trim()),
  );

  // Parent choices for the filter: the literal roots filter is always
  // available, and unit choices come from the flat hierarchy read. If that
  // read fails, only the roots filter degrades — the URL can still carry a
  // parent id, and the backend validates it either way.
  const [parentChoices, setParentChoices] = useState<FilterOption[]>([
    { value: "null", label: "Roots only" },
  ]);
  useEffect(() => {
    let cancelled = false;
    getOrganizationTree().then((result) => {
      if (cancelled || !result.ok) return;
      setParentChoices([
        { value: "null", label: "Roots only" },
        ...result.data.results.map((unit) => ({
          value: String(unit.id),
          label: `${unit.code} — ${unit.name}`,
        })),
      ]);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // A shared URL may name a parent the tree no longer (or yet) contains; keep
  // it selectable rather than showing a blank option.
  const parentOptions = useMemo<FilterOption[]>(() => {
    if (draft.parent && !parentChoices.some((option) => option.value === draft.parent)) {
      return [...parentChoices, { value: draft.parent, label: `Unit #${draft.parent}` }];
    }
    return parentChoices;
  }, [draft.parent, parentChoices]);

  /**
   * Which lifecycle controls a row may show. The root can never leave ACTIVE,
   * and a unit only moves forward one step, so each status has at most one
   * next transition. Nothing is offered where the API has no endpoint.
   */
  function availableAction(org: Organization): LifecycleAction | null {
    if (org.parent === null) return null; // root is protected
    if (org.status === "ACTIVE") return "deactivate";
    if (org.status === "INACTIVE") return "archive";
    return null; // archived is terminal
  }

  async function confirmLifecycle() {
    if (!confirmTarget) return;
    const { organization, action } = confirmTarget;

    setPending(true);
    setConfirmError(null);
    try {
      // Re-read the unit for a fresh strong ETag: the list rows carry none,
      // and preconditioning on current state is what makes the write safe.
      const detail = await getOrganization(organization.id);
      if (!detail.ok) {
        setConfirmError(deserializeApiError(detail.error));
        return;
      }
      const etag = detail.data.etag;
      if (!etag) {
        setConfirmError(
          deserializeApiError({
            status: 428,
            code: "precondition_required",
            message:
              "The server did not return a concurrency token for this organization.",
            details: null,
            requestId: detail.data.requestId,
          }),
        );
        return;
      }

      const result =
        action === "deactivate"
          ? await deactivateOrganization(organization.id, etag)
          : await archiveOrganization(organization.id, etag);

      if (!result.ok) {
        setConfirmError(deserializeApiError(result.error));
        return;
      }

      toast.success(
        action === "deactivate"
          ? `${organization.name} deactivated.`
          : `${organization.name} archived.`,
      );
      setConfirmTarget(null);
      organizations.reload();
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const rows = organizations.data?.results ?? [];
  const count = organizations.data?.count ?? 0;

  const columns = [
    {
      field: "code",
      header: "Code",
      sortable: true,
      render: (row: Organization) => (
        <Typography variant="body2" sx={{ fontFamily: "monospace", fontWeight: 600 }}>
          {row.code}
        </Typography>
      ),
    },
    {
      field: "name",
      header: "Name",
      sortable: true,
      render: (row: Organization) => (
        <Box component="span" sx={{ display: "flex", flexDirection: "column" }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            <Link href={`/organizations/${row.id}`} style={{ color: "inherit" }}>
              {row.name}
            </Link>
          </Typography>
          {row.short_name ? (
            <Typography variant="caption" color="text.secondary">
              {row.short_name}
            </Typography>
          ) : null}
        </Box>
      ),
    },
    {
      field: "organization_type",
      header: "Type",
      render: (row: Organization) => (
        <Typography variant="body2">{organizationTypeLabel(row.organization_type)}</Typography>
      ),
    },
    {
      field: "parent",
      header: "Parent",
      render: (row: Organization) => (
        <Typography variant="body2" color="text.secondary">
          {row.parent === null ? "Root" : `Unit #${row.parent}`}
        </Typography>
      ),
    },
    {
      field: "status",
      header: "Status",
      render: (row: Organization) => {
        const chip = statusChip(row.status);
        return <Chip size="small" color={chip.color} label={chip.label} variant="outlined" />;
      },
    },
    {
      field: "updated_at",
      header: "Updated",
      sortable: true,
      render: (row: Organization) => (
        <Typography variant="body2" color="text.secondary">
          {new Date(row.updated_at).toLocaleDateString()}
        </Typography>
      ),
    },
  ];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
      <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 3 }}>
        <Box
          sx={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1.5,
            px: { xs: 2, sm: 3 },
            py: 2,
            background:
              "linear-gradient(110deg, rgba(0,51,102,0.04), rgba(255,255,255,1) 70%)",
          }}
        >
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Organization directory
            </Typography>
            <Typography variant="body2" color="text.secondary" aria-live="polite">
              {organizations.loading
                ? "Loading organizations…"
                : `${count} organization${count === 1 ? "" : "s"} found`}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Button
              component={Link}
              href="/organizations/hierarchy"
              variant="outlined"
              startIcon={<AccountTreeRoundedIcon />}
            >
              Hierarchy
            </Button>
            <Button
              component={Link}
              href="/organizations/new"
              variant="contained"
              startIcon={<AddIcon />}
            >
              New organization
            </Button>
          </Box>
        </Box>
        <Box sx={{ borderTop: 1, borderColor: "divider", p: { xs: 1.5, sm: 2.5 } }}>
          <FilterBar
            label="Organization filters"
            activeCount={activeFilterCount}
            onApply={applyFilters}
            onReset={resetFilters}
            resetDisabled={organizations.loading}
          >
            <TextFilter
              label="Search"
              value={draft.search ?? ""}
              onChange={(value) => setDraft((prev) => ({ ...prev, search: value }))}
              placeholder="Name or code"
              hint="Case-insensitive substring of name or code."
            />
            <TextFilter
              label="Name"
              value={draft.name}
              onChange={(value) => setDraft((prev) => ({ ...prev, name: value }))}
              placeholder="Organization name"
              hint="Case-insensitive name substring."
            />
            <TextFilter
              label="Code"
              value={draft.code}
              onChange={(value) => setDraft((prev) => ({ ...prev, code: value }))}
              placeholder="Exact organization code"
              hint={
                invalidCode
                  ? "Use 1-64 letters, digits, underscores or hyphens; start with a letter."
                  : "Exact code; matching is case-insensitive."
              }
              invalid={invalidCode}
            />
            <SelectFilter
              label="Type"
              value={draft.type ?? ""}
              options={[...ORGANIZATION_TYPE_OPTIONS]}
              onChange={(value) => setDraft((prev) => ({ ...prev, type: value }))}
            />
            <SelectFilter
              label="Status"
              value={draft.status ?? ""}
              options={[...ORGANIZATION_STATUS_OPTIONS]}
              onChange={(value) => setDraft((prev) => ({ ...prev, status: value }))}
            />
            <SelectFilter
              label="Parent"
              value={draft.parent}
              options={parentOptions}
              onChange={(value) => setDraft((prev) => ({ ...prev, parent: value }))}
              allLabel="Any parent"
            />
          </FilterBar>
        </Box>
        <Box sx={{ borderTop: 1, borderColor: "divider", overflowX: "auto" }}>
          <DataTable<Organization>
            caption="Organization units"
            columns={columns}
            rows={rows}
            getRowKey={(row) => row.id}
            sort={sort}
            onSortChange={changeSort}
            loading={organizations.loading}
            error={organizations.error}
            onRetry={organizations.reload}
            emptyState={
              activeFilterCount > 0 ? (
                <Box sx={{ py: 5, px: 3, textAlign: "center" }}>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    No organizations match these filters
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Adjust or reset the filters to see more results.
                  </Typography>
                  <Button onClick={resetFilters} sx={{ mt: 2 }} variant="outlined">
                    Reset filters
                  </Button>
                </Box>
              ) : undefined
            }
            renderActions={(row) => {
              const action = availableAction(row);
              return (
                <Box sx={{ display: "flex", gap: 0.5, justifyContent: "flex-end" }}>
                  <Tooltip title={`View ${row.name}`}>
                    <IconButton
                      component={Link}
                      href={`/organizations/${row.id}`}
                      size="small"
                      aria-label={`View ${row.name}`}
                    >
                      <BusinessRoundedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={`Edit ${row.name}`}>
                    <IconButton
                      component={Link}
                      href={`/organizations/${row.id}/edit`}
                      size="small"
                      aria-label={`Edit ${row.name}`}
                    >
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  {action ? (
                    <Button
                      size="small"
                      color={action === "archive" ? "error" : "warning"}
                      variant="outlined"
                      onClick={() => {
                        setConfirmError(null);
                        setConfirmTarget({ organization: row, action });
                      }}
                    >
                      {action === "deactivate" ? "Deactivate" : "Archive"}
                    </Button>
                  ) : row.status === "ARCHIVED" ? (
                    <Typography
                      variant="caption"
                      color="text.disabled"
                      sx={{ alignSelf: "center" }}
                    >
                      Archived
                    </Typography>
                  ) : row.parent === null ? (
                    <Typography
                      variant="caption"
                      color="text.disabled"
                      sx={{ alignSelf: "center" }}
                    >
                      Root
                    </Typography>
                  ) : null}
                </Box>
              );
            }}
          />
        </Box>
        {count > 0 ? (
          <Box sx={{ borderTop: 1, borderColor: "divider", px: { xs: 1, sm: 2 } }}>
            <Pagination
              page={page}
              count={count}
              pageSize={PAGE_SIZE}
              onPageChange={changePage}
              label="Organizations pagination"
              disabled={organizations.loading}
            />
          </Box>
        ) : null}
      </Paper>

      <ConfirmDialog
        open={confirmTarget !== null}
        title={
          confirmTarget?.action === "deactivate"
            ? "Deactivate organization?"
            : "Archive organization?"
        }
        description={
          confirmTarget?.action === "deactivate"
            ? "This moves the unit from Active to Inactive. It stops being selectable as an active parent, and any active children must be deactivated first or the platform will refuse the change."
            : "This moves the unit from Inactive to Archived — the final state. Archived units cannot be moved or retyped, and they cannot be brought back online."
        }
        confirmColor={confirmTarget?.action === "archive" ? "error" : "primary"}
        confirmLabel={
          confirmTarget?.action === "deactivate" ? "Deactivate" : "Archive"
        }
        pending={pending}
        error={confirmError}
        onConfirm={confirmLifecycle}
        onCancel={() => {
          if (!pending) {
            setConfirmTarget(null);
            setConfirmError(null);
          }
        }}
      >
        {confirmTarget ? (
          <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
            {confirmTarget.organization.code} — {confirmTarget.organization.name}
          </Typography>
        ) : null}
      </ConfirmDialog>
    </Box>
  );
}
