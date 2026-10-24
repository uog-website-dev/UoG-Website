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
 * The backend does not expose a reactivation endpoint: the lifecycle is
 * forward-only (ACTIVE -> INACTIVE -> ARCHIVED). The UI therefore never offers
 * an "activate" action, because offering one would present a control that no
 * API supports. Deactivate/archive on the root or on a unit with active
 * descendants are refused by the database rules and shown as errors.
 */
import { useCallback, useMemo, useState } from "react";
import AddIcon from "@mui/icons-material/Add";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  listOrganizations,
} from "@/app/organizations/actions";
import { deserializeApiError, unwrap } from "@/organizations/contract";
import type { ApiError } from "@uog/api-client";
import {
  ORGANIZATION_STATUS_OPTIONS,
  ORGANIZATION_TYPE_OPTIONS,
  organizationTypeLabel,
} from "@/organizations/validation";

type LifecycleAction = "deactivate" | "archive";

const PAGE_SIZE = 20;

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
  const toast = useToast();

  // Draft filter values, applied only on Apply/Reset so the backend is not
  // queried per keystroke and the URL stays shareable.
  const [draft, setDraft] = useState<OrganizationListQuery>({});
  const [applied, setApplied] = useState<OrganizationListQuery>({});
  const [page, setPage] = useState(1);

  const query = useMemo<OrganizationListQuery>(
    () => ({ ...applied, page }),
    [applied, page],
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
    setApplied(draft);
    setPage(1);
  }, [draft]);

  const resetFilters = useCallback(() => {
    setDraft({});
    setApplied({});
    setPage(1);
  }, []);

  const activeFilterCount = useMemo(
    () =>
      Object.values(applied).filter(
        (value) => value !== undefined && value !== "",
      ).length,
    [applied],
  );

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
            {row.name}
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
      <Box
        sx={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1.5,
        }}
      >
        <Typography variant="body2" color="text.secondary" aria-live="polite">
          {organizations.loading
            ? "Loading organizations…"
            : `${count} organization${count === 1 ? "" : "s"}`}
        </Typography>
        <Button
          component={Link}
          href="/organizations/new"
          variant="contained"
          startIcon={<AddIcon />}
        >
          New organization
        </Button>
      </Box>

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
        <SelectFilter
          label="Type"
          value={draft.type ?? ""}
          options={[...ORGANIZATION_TYPE_OPTIONS]}
          onChange={(value) => setDraft((prev) => ({ ...prev, type: value || undefined }))}
        />
        <SelectFilter
          label="Status"
          value={draft.status ?? ""}
          options={[...ORGANIZATION_STATUS_OPTIONS]}
          onChange={(value) =>
            setDraft((prev) => ({
              ...prev,
              status: (value || undefined) as OrganizationListQuery["status"],
            }))
          }
        />
      </FilterBar>

      <DataTable<Organization>
        caption="Organization units"
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
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
                <Typography variant="caption" color="text.disabled" sx={{ alignSelf: "center" }}>
                  Archived
                </Typography>
              ) : row.parent === null ? (
                <Typography variant="caption" color="text.disabled" sx={{ alignSelf: "center" }}>
                  Root
                </Typography>
              ) : null}
            </Box>
          );
        }}
      />

      {count > 0 ? (
        <Pagination
          page={page}
          count={count}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          label="Organizations pagination"
          disabled={organizations.loading}
        />
      ) : null}

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
