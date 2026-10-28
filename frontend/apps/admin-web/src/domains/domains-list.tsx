"use client";

/**
 * Domain Management: every hostname registered across all Sites, with its
 * owning Site, organization, type and status.
 *
 * Reads go through the `listAllDomains` server action, so the Keycloak
 * access token stays server-side. The platform API exposes domains per Site
 * only, so the typed client composes this listing from the approved
 * endpoints (see @uog/api-client `listDomainsAll`) and applies the filters,
 * ordering and pagination here — no backend change was required, and a
 * production build refuses mock mode outright, so this screen can only ever
 * show real records in a deployed integration.
 *
 * A domain row is a routing record: it does not prove DNS or TLS exists,
 * and the screen never implies that it does. Mutations are out of scope
 * here — the per-site Domains panel on the site detail screen owns them.
 */
import { useState } from "react";
import AddIcon from "@mui/icons-material/Add";
import LanguageRoundedIcon from "@mui/icons-material/LanguageRounded";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import NextLink from "next/link";
import {
  DataTable,
  FilterBar,
  Pagination,
  SelectFilter,
  TextFilter,
  useAsync,
} from "@uog/ui";
import type { SortState, TableColumn } from "@uog/ui";
import { DOMAINS_PAGE_SIZE } from "@uog/api-client";
import type {
  DomainRecord,
  PaginatedResponse,
  Site,
  SiteDomainStatus,
} from "@uog/types";

import {
  listAllDomains,
  listAllSites,
  listSiteDomains,
} from "@/app/sites/actions";
import { getOrganizationTree } from "@/app/organizations/actions";
import { unwrap } from "@/organizations/contract";
import { DomainFormDialog } from "@/domains/domain-form-dialog";
import { siteStatusChip } from "@/sites/validation";

interface DomainFilters {
  search: string;
  /** Select value: "" = every site. */
  site: string;
  /** Select value: "" | "primary" | "alias". */
  type: string;
  /** Select value: "" | SiteDomainStatus. */
  status: string;
}

const EMPTY_FILTERS: DomainFilters = { search: "", site: "", type: "", status: "" };

const TYPE_OPTIONS = [
  { value: "primary", label: "Primary" },
  { value: "alias", label: "Alias" },
];

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
];

function domainStatusChip(status: SiteDomainStatus): {
  color: "success" | "default";
  label: string;
} {
  return status === "ACTIVE"
    ? { color: "success", label: "Active" }
    : { color: "default", label: "Inactive" };
}

export function DomainsList() {
  const [filters, setFilters] = useState<DomainFilters>(EMPTY_FILTERS);
  const [draft, setDraft] = useState<DomainFilters>(EMPTY_FILTERS);
  const [ordering, setOrdering] = useState<SortState | null>({
    field: "hostname",
    direction: "asc",
  });
  const [page, setPage] = useState(1);

  // Add/edit dialog: `record` null means "add".
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DomainRecord | null>(null);

  const domains = useAsync<PaginatedResponse<DomainRecord>>(
    async () =>
      unwrap(
        await listAllDomains({
          ...(filters.search ? { search: filters.search } : {}),
          ...(filters.site ? { site: Number(filters.site) } : {}),
          ...(filters.type
            ? { is_primary: filters.type === "primary" }
            : {}),
          ...(filters.status
            ? { status: filters.status as SiteDomainStatus }
            : {}),
          ...(ordering
            ? {
                ordering:
                  ordering.direction === "desc"
                    ? `-${ordering.field}`
                    : ordering.field,
              }
            : {}),
          page,
        }),
      ),
    [
      filters.search,
      filters.site,
      filters.type,
      filters.status,
      ordering?.field,
      ordering?.direction,
      page,
    ],
  );

  // Site filter options and organization labels come from their own reads;
  // a failure degrades to ids instead of guessing names.
  const sitesState = useAsync<Site[]>(
    async () => unwrap(await listAllSites()),
    [],
  );
  const orgsState = useAsync<{ results: { id: number; code: string; name: string }[] }>(
    async () => unwrap(await getOrganizationTree()),
    [],
  );

  const activeCount =
    (filters.search ? 1 : 0) +
    (filters.site ? 1 : 0) +
    (filters.type ? 1 : 0) +
    (filters.status ? 1 : 0);
  const filtered = activeCount > 0;

  const siteOptions = (sitesState.data ?? []).map((site) => ({
    value: String(site.id),
    label: `${site.code} — ${site.name}`,
  }));

  const orgById = new Map(
    (orgsState.data?.results ?? []).map((unit) => [unit.id, unit]),
  );

  const columns: TableColumn<DomainRecord>[] = [
    {
      field: "hostname",
      header: "Hostname",
      sortable: true,
      render: (row) => (
        <Typography sx={{ fontFamily: "monospace", fontWeight: 700 }}>
          {row.hostname}
        </Typography>
      ),
    },
    {
      field: "site",
      header: "Site",
      sortable: true,
      render: (row) => (
        <Link
          component={NextLink}
          href={`/sites/${row.site}`}
          underline="hover"
          sx={{ fontWeight: 600 }}
        >
          {row.site_name} ({row.site_code})
        </Link>
      ),
    },
    {
      field: "organization",
      header: "Organization",
      sortable: true,
      render: (row) => {
        const unit = orgById.get(row.organization_unit);
        return unit
          ? `${unit.code} — ${unit.name}`
          : `Unit #${row.organization_unit}`;
      },
    },
    {
      field: "type",
      header: "Type",
      sortable: true,
      render: (row) => (
        <Chip
          size="small"
          color={row.is_primary ? "primary" : "default"}
          variant={row.is_primary ? "filled" : "outlined"}
          label={row.is_primary ? "Primary" : "Alias"}
        />
      ),
    },
    {
      field: "status",
      header: "Domain status",
      sortable: true,
      render: (row) => {
        const chip = domainStatusChip(row.status);
        return (
          <Chip
            size="small"
            color={chip.color}
            variant="outlined"
            label={chip.label}
          />
        );
      },
    },
    {
      field: "site_status",
      header: "Site status",
      sortable: true,
      render: (row) => {
        const chip = siteStatusChip(row.site_status);
        return (
          <Chip
            size="small"
            color={chip.color}
            variant="outlined"
            label={chip.label}
          />
        );
      },
    },
  ];

  const renderActions = (row: DomainRecord) => (
    <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
      <Button
        size="small"
        variant="outlined"
        onClick={() => {
          setEditing(row);
          setDialogOpen(true);
        }}
        aria-label={`Edit ${row.hostname}`}
      >
        Edit
      </Button>
      <Button
        size="small"
        variant="outlined"
        component={NextLink}
        href={`/sites/${row.site}`}
      >
        Site details
      </Button>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Paper
        variant="outlined"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: { xs: 2, sm: 3 },
          p: { xs: 2.5, sm: 3.5 },
          borderRadius: 3,
          background:
            "linear-gradient(115deg, rgba(0,51,102,0.08), rgba(255,255,255,0.96) 64%, rgba(255,184,28,0.14))",
        }}
      >
        <Box
          sx={{
            display: { xs: "none", sm: "grid" },
            placeItems: "center",
            flex: "0 0 auto",
            width: 64,
            height: 64,
            borderRadius: 3,
            bgcolor: "primary.main",
            color: "primary.contrastText",
            boxShadow: 2,
          }}
        >
          <LanguageRoundedIcon fontSize="large" />
        </Box>
        <Box>
          <Chip
            size="small"
            label="Central address directory"
            color="primary"
            variant="outlined"
            sx={{ mb: 1, fontWeight: 600 }}
          />
          <Typography variant="h5" component="h2" sx={{ fontWeight: 700 }}>
            Configured domains
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5, maxWidth: 680 }}>
            Every hostname the platform knows about, with the Site and
            organization it belongs to. A domain row is routing data only —
            this platform provisions neither DNS records nor TLS
            certificates.
          </Typography>
        </Box>
      </Paper>

      <FilterBar
        label="Domain filters"
        activeCount={activeCount}
        resetDisabled={domains.loading}
        onApply={() => {
          setFilters({ ...draft });
          setPage(1);
        }}
        onReset={() => {
          setDraft(EMPTY_FILTERS);
          setFilters(EMPTY_FILTERS);
          setPage(1);
        }}
      >
        <TextFilter
          label="Search"
          value={draft.search}
          onChange={(value) =>
            setDraft((previous) => ({ ...previous, search: value }))
          }
          placeholder="uog.edu.et"
          hint="Hostname, site code or site name."
        />
        <SelectFilter
          label="Site"
          value={draft.site}
          options={siteOptions}
          onChange={(value) =>
            setDraft((previous) => ({ ...previous, site: value }))
          }
          includeAll
          allLabel="All sites"
        />
        <SelectFilter
          label="Type"
          value={draft.type}
          options={TYPE_OPTIONS}
          onChange={(value) =>
            setDraft((previous) => ({ ...previous, type: value }))
          }
          includeAll
          allLabel="All types"
        />
        <SelectFilter
          label="Status"
          value={draft.status}
          options={STATUS_OPTIONS}
          onChange={(value) =>
            setDraft((previous) => ({ ...previous, status: value }))
          }
          includeAll
          allLabel="All statuses"
        />
      </FilterBar>

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
              Domains
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {domains.data
                ? `${domains.data.count} hostname${domains.data.count === 1 ? "" : "s"} registered`
                : "Loading the platform's domain records…"}
              . Select a Site to open its details.
            </Typography>
          </Box>
          {orgsState.error ? (
            <Typography variant="caption" color="warning.main">
              Organization names unavailable — units are shown by id.
            </Typography>
          ) : null}
          {sitesState.error ? (
            <Typography variant="caption" color="warning.main">
              The site filter may be incomplete: the site list could not be
              loaded.
            </Typography>
          ) : null}
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            disabled={sitesState.error !== null}
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            Add domain
          </Button>
        </Box>

        <DataTable
          caption="Configured domains"
          columns={columns}
          rows={domains.data?.results ?? []}
          getRowKey={(row) => row.id}
          renderActions={renderActions}
          loading={domains.loading}
          error={domains.error}
          onRetry={() => domains.reload()}
          sort={ordering}
          onSortChange={(next) => {
            setOrdering(next);
            setPage(1);
          }}
          emptyState={
            <Box
              sx={{
                display: "grid",
                justifyItems: "center",
                gap: 1.5,
                py: 6,
                px: 3,
                textAlign: "center",
              }}
            >
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {filtered
                  ? "No domains match these filters"
                  : "No domains are registered"}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {filtered
                  ? "Clear the filters to see every configured hostname."
                  : "The platform has no hostname records yet. Domains are registered per Site on the site details screen."}
              </Typography>
              {filtered ? (
                <Button
                  variant="outlined"
                  onClick={() => {
                    setDraft(EMPTY_FILTERS);
                    setFilters(EMPTY_FILTERS);
                    setPage(1);
                  }}
                >
                  Clear filters
                </Button>
              ) : null}
            </Box>
          }
        />

        {domains.data && domains.data.count > (domains.data.results?.length ?? 0) ? (
          <Pagination
            page={page}
            count={domains.data.count}
            pageSize={DOMAINS_PAGE_SIZE}
            onPageChange={(next) => setPage(next)}
            label="Domains pagination"
          />
        ) : null}
      </Paper>

      <DomainFormDialog
        open={dialogOpen}
        record={editing}
        sites={sitesState.data ?? []}
        onClose={() => setDialogOpen(false)}
        onSaved={() => {
          domains.reload();
        }}
      />
    </Box>
  );
}
