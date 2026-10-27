"use client";

/**
 * Site list: discovery filters, pagination and the approved lifecycle
 * actions (activate / suspend / archive).
 *
 * Reads go through `listSites` (a server action) so the access token stays
 * server-side; `useAsync` owns loading/empty/error rendering through the
 * shared states. Every lifecycle change is confirmed first, then executed
 * against a *fresh* strong ETag fetched inside the action, so a stale row can
 * never silently overwrite a newer one — a 412 is surfaced as a concurrency
 * message instead.
 *
 * The applied filters, page and sort live in the URL query string (see
 * ./list-query), so any view of the list is shareable and survives reload.
 * URL values that do not match the documented contract are dropped rather
 * than sent — the backend rejects invalid parameters with 400.
 *
 * Lifecycle controls follow the backend matrix exactly (DRAFT -> ACTIVE or
 * ARCHIVED, ACTIVE -> SUSPENDED or ARCHIVED, SUSPENDED -> ACTIVE or ARCHIVED,
 * ARCHIVED terminal), and activation is offered even when the owner rule may
 * refuse it: the refusal arrives as a structured 400 and is shown, because
 * the owner's state is the server's call, not the client's guess.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import AddIcon from "@mui/icons-material/Add";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import LanguageRoundedIcon from "@mui/icons-material/LanguageRounded";
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
  PaginatedResponse,
  Site,
  SiteListQuery,
  SiteStatus,
} from "@uog/types";

import {
  activateSite,
  archiveSite,
  listSites,
  listSiteDomains,
  suspendSite,
} from "@/app/sites/actions";
import { getOrganizationTree } from "@/app/organizations/actions";
import { deserializeApiError, unwrap } from "@/organizations/contract";
import type { ActionResult } from "@/organizations/contract";
import { ownerInfoFor, relationLabel } from "@/sites/owner";
import type { ApiError } from "@uog/api-client";
import {
  draftFromQuery,
  draftToQuery,
  emptyDraft,
  orderingFromSort,
  parseListQuery,
  sortFromOrdering,
} from "@/sites/list-query";
import {
  SITE_STATUS_OPTIONS,
  siteStatusChip,
  siteStatusLabel,
} from "@/sites/validation";

type LifecycleAction = "activate" | "suspend" | "archive";

const PAGE_SIZE = 20;

function sameQuery(left: SiteListQuery, right: SiteListQuery): boolean {
  return (
    left.search === right.search &&
    left.code === right.code &&
    left.status === right.status &&
    left.organization_unit === right.organization_unit &&
    left.page === right.page &&
    left.ordering === right.ordering
  );
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

/**
 * Primary hostname for one row's site.
 *
 * Domains are only readable per site (the API has no cross-site domain
 * list), so each cell reads its own site's hostnames — a page of 20 rows
 * costs 20 small GETs, which the admin console accepts for accuracy. A
 * failed read shows "Unavailable" rather than an empty cell, so missing
 * data is never mistaken for "no domain".
 */
function PrimaryDomainCell({ siteId }: { siteId: number }) {
  const domains = useAsync(
    async () => unwrap(await listSiteDomains(siteId)),
    [siteId],
  );

  if (domains.loading) {
    return (
      <Typography variant="body2" color="text.disabled" aria-live="polite">
        …
      </Typography>
    );
  }
  if (domains.error) {
    return (
      <Tooltip title={domains.error.message}>
        <Typography variant="body2" color="text.disabled">
          Unavailable
        </Typography>
      </Tooltip>
    );
  }

  const results = domains.data?.results ?? [];
  const primary =
    results.find((domain) => domain.is_primary && domain.status === "ACTIVE") ??
    results.find((domain) => domain.is_primary);

  if (!primary) {
    return (
      <Typography variant="body2" color="text.secondary">
        No primary domain
      </Typography>
    );
  }

  return (
    <Box component="span" sx={{ display: "flex", flexDirection: "column" }}>
      <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
        {primary.hostname}
      </Typography>
      {primary.status !== "ACTIVE" ? (
        <Typography variant="caption" color="text.disabled">
          Inactive
        </Typography>
      ) : null}
    </Box>
  );
}

const CONFIRM_COPY: Record<
  LifecycleAction,
  { title: string; description: string }
> = {
  activate: {
    title: "Activate site?",
    description:
      "The site becomes publicly servable. The platform requires the owning organization unit to be active — if it is not, the server refuses the change and this dialog shows why.",
  },
  suspend: {
    title: "Suspend site?",
    description:
      "The site stops being served but keeps its row, configuration and owner link. It can be activated again later.",
  },
  archive: {
    title: "Archive site?",
    description:
      "Archiving is final: the site can never be activated, suspended, re-owned or re-marked as main again. The row and its configuration are retained as history.",
  },
};

export function SitesList() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();

  const [applied, setApplied] = useState<SiteListQuery>(() => {
    const { page: _page, ordering: _ordering, ...filters } = parseListQuery(searchParams);
    return filters;
  });
  const [page, setPage] = useState(() => parseListQuery(searchParams).page ?? 1);
  const [sort, setSort] = useState<SortState>(() =>
    sortFromOrdering(searchParams.get("ordering")),
  );
  const [draft, setDraft] = useState(() => draftFromQuery(parseListQuery(searchParams)));
  const urlQuery = searchParams.toString();

  // Keep back/forward navigation in sync with the controls and the query.
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
      current.code === nextDraft.code &&
      current.status === nextDraft.status &&
      current.organization_unit === nextDraft.organization_unit
        ? current
        : nextDraft,
    );
  }, [urlQuery]);

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

  const query = useMemo<SiteListQuery>(
    () => ({ ...applied, page, ordering: orderingFromSort(sort) }),
    [applied, page, sort],
  );

  const sites = useAsync<PaginatedResponse<Site>>(
    async () => unwrap(await listSites(query)),
    [query],
    { isEmpty: (data) => data.count === 0 },
  );

  const [pending, setPending] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<{
    site: Site;
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
      code: next.code,
      status: next.status,
      organization_unit:
        next.organization_unit === undefined
          ? undefined
          : String(next.organization_unit),
      page: undefined,
    });
  }, [draft, writeUrl]);

  const resetFilters = useCallback(() => {
    setDraft(emptyDraft());
    setApplied({});
    setPage(1);
    writeUrl({
      search: undefined,
      code: undefined,
      status: undefined,
      organization_unit: undefined,
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
      Object.values(applied).filter((value) => value !== undefined && value !== "").length,
    [applied],
  );
  const invalidCode = Boolean(
    draft.code.trim() && !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(draft.code.trim()),
  );

  // Owner choices for the filter, plus the full unit list the rows use to
  // label each site's owner organization. If the hierarchy read fails, rows
  // degrade to "Unit #id" with an unknown relation — never a guess.
  const [units, setUnits] = useState<Organization[]>([]);
  useEffect(() => {
    let cancelled = false;
    getOrganizationTree().then((result: ActionResult<{ results: Organization[] }>) => {
      if (cancelled || !result.ok) return;
      setUnits(result.data.results);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const ownerChoices = useMemo<FilterOption[]>(
    () =>
      units.map((unit) => ({
        value: String(unit.id),
        label: `${unit.code} — ${unit.name}`,
      })),
    [units],
  );

  const ownerOptions = useMemo<FilterOption[]>(() => {
    if (
      draft.organization_unit &&
      !ownerChoices.some((option) => option.value === draft.organization_unit)
    ) {
      return [...ownerChoices, { value: draft.organization_unit, label: `Unit #${draft.organization_unit}` }];
    }
    return ownerChoices;
  }, [draft.organization_unit, ownerChoices]);

  async function confirmLifecycle() {
    if (!confirmTarget) return;
    const { site, action } = confirmTarget;

    setPending(true);
    setConfirmError(null);
    try {
      const result =
        action === "activate"
          ? await activateSite(site.id)
          : action === "suspend"
            ? await suspendSite(site.id)
            : await archiveSite(site.id);

      if (!result.ok) {
        // 403 (writes disabled), 400 (owner/lifecycle rule), 412 (stale) and
        // 409 (conflict) all render here verbatim — nothing is masked.
        setConfirmError(deserializeApiError(result.error));
        return;
      }

      const pastTense: Record<LifecycleAction, string> = {
        activate: "activated",
        suspend: "suspended",
        archive: "archived",
      };
      toast.success(`${site.name} ${pastTense[action]}.`);
      setConfirmTarget(null);
      sites.reload();
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const rows = sites.data?.results ?? [];
  const count = sites.data?.count ?? 0;

  const columns = [
    {
      field: "code",
      header: "Code",
      sortable: true,
      render: (row: Site) => (
        <Typography variant="body2" sx={{ fontFamily: "monospace", fontWeight: 600 }}>
          {row.code}
        </Typography>
      ),
    },
    {
      field: "name",
      header: "Name",
      sortable: true,
      render: (row: Site) => (
        <Box component="span" sx={{ display: "flex", flexDirection: "column" }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            <Link href={`/sites/${row.id}`} style={{ color: "inherit" }}>
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
      field: "organization_unit",
      header: "Owner",
      render: (row: Site) => {
        const owner = ownerInfoFor(row, units);
        const relationColor =
          owner.relation === "root"
            ? ("primary" as const)
            : owner.relation === "unknown"
              ? ("warning" as const)
              : ("default" as const);
        return (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {owner.name ?? `Unit #${owner.unitId}`}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {owner.code ? `${owner.code} · ` : ""}
              {owner.typeLabel ?? "Type unknown"}
            </Typography>
            <Box>
              <Chip
                size="small"
                variant="outlined"
                color={relationColor}
                label={relationLabel(owner.relation)}
                title={
                  owner.relation === "child" && owner.rootName
                    ? `Under ${owner.rootName}`
                    : undefined
                }
              />
            </Box>
          </Box>
        );
      },
    },
    {
      field: "primary_domain",
      header: "Primary domain",
      render: (row: Site) => <PrimaryDomainCell siteId={row.id} />,
    },
    {
      field: "status",
      header: "Status",
      sortable: true,
      render: (row: Site) => {
        const chip = siteStatusChip(row.status);
        return <Chip size="small" color={chip.color} label={chip.label} variant="outlined" />;
      },
    },
    {
      field: "updated_at",
      header: "Updated",
      sortable: true,
      render: (row: Site) => (
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
              Managed sites
            </Typography>
            <Typography variant="body2" color="text.secondary" aria-live="polite">
              {sites.loading
                ? "Loading sites…"
                : `${count} site${count === 1 ? "" : "s"} found`}
            </Typography>
          </Box>
          <Button
            component={Link}
            href="/sites/new"
            variant="contained"
            startIcon={<AddIcon />}
          >
            New site
          </Button>
        </Box>
        <Box sx={{ borderTop: 1, borderColor: "divider", p: { xs: 1.5, sm: 2.5 } }}>
          <FilterBar
            label="Site filters"
            activeCount={activeFilterCount}
            onApply={applyFilters}
            onReset={resetFilters}
            resetDisabled={sites.loading}
          >
            <TextFilter
              label="Search"
              value={draft.search ?? ""}
              onChange={(value) => setDraft((prev) => ({ ...prev, search: value }))}
              placeholder="Name or code"
              hint="Case-insensitive substring of name or code."
            />
            <TextFilter
              label="Code"
              value={draft.code}
              onChange={(value) => setDraft((prev) => ({ ...prev, code: value }))}
              placeholder="Exact site code"
              hint={
                invalidCode
                  ? "Use 1-64 letters, digits, underscores or hyphens; start with a letter."
                  : "Exact code; matching is case-insensitive."
              }
              invalid={invalidCode}
            />
            <SelectFilter
              label="Status"
              value={draft.status ?? ""}
              options={[...SITE_STATUS_OPTIONS]}
              onChange={(value) => setDraft((prev) => ({ ...prev, status: value }))}
            />
            <SelectFilter
              label="Owner"
              value={draft.organization_unit}
              options={ownerOptions}
              onChange={(value) =>
                setDraft((prev) => ({ ...prev, organization_unit: value }))
              }
              allLabel="Any owner"
            />
          </FilterBar>
        </Box>
        <Box sx={{ borderTop: 1, borderColor: "divider", overflowX: "auto" }}>
          <DataTable<Site>
            caption="Managed sites"
            columns={columns}
            rows={rows}
            getRowKey={(row) => row.id}
            sort={sort}
            onSortChange={changeSort}
            loading={sites.loading}
            error={sites.error}
            onRetry={sites.reload}
            emptyState={
              activeFilterCount > 0 ? (
                <Box sx={{ py: 5, px: 3, textAlign: "center" }}>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    No sites match these filters
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
              const actions = availableActions(row.status);
              return (
                <Box sx={{ display: "flex", gap: 0.5, justifyContent: "flex-end", alignItems: "center" }}>
                  <Tooltip title={`View ${row.name}`}>
                    <IconButton
                      component={Link}
                      href={`/sites/${row.id}`}
                      size="small"
                      aria-label={`View ${row.name}`}
                    >
                      <LanguageRoundedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={`Edit ${row.name}`}>
                    <IconButton
                      component={Link}
                      href={`/sites/${row.id}/edit`}
                      size="small"
                      aria-label={`Edit ${row.name}`}
                      disabled={row.status === "ARCHIVED"}
                    >
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  {actions.map((action) => (
                    <Button
                      key={action}
                      size="small"
                      color={action === "archive" ? "error" : action === "suspend" ? "warning" : "primary"}
                      variant="outlined"
                      onClick={() => {
                        setConfirmError(null);
                        setConfirmTarget({ site: row, action });
                      }}
                    >
                      {ACTION_LABELS[action]}
                    </Button>
                  ))}
                  {row.status === "ARCHIVED" ? (
                    <Typography variant="caption" color="text.disabled" sx={{ alignSelf: "center" }}>
                      Archived
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
              label="Sites pagination"
              disabled={sites.loading}
            />
          </Box>
        ) : null}
      </Paper>

      <ConfirmDialog
        open={confirmTarget !== null}
        title={confirmTarget ? CONFIRM_COPY[confirmTarget.action].title : ""}
        description={
          confirmTarget ? CONFIRM_COPY[confirmTarget.action].description : ""
        }
        confirmColor={confirmTarget?.action === "archive" ? "error" : "primary"}
        confirmLabel={
          confirmTarget ? ACTION_LABELS[confirmTarget.action] : "Confirm"
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
            {confirmTarget.site.code} — {confirmTarget.site.name} ·{" "}
            {siteStatusLabel(confirmTarget.site.status)}
          </Typography>
        ) : null}
      </ConfirmDialog>
    </Box>
  );
}
