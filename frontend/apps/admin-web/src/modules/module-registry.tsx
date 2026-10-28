"use client";

/**
 * Platform module registry: the read-only catalogue of capabilities.
 *
 * Reads go through the `listPlatformModules` server action, so the Keycloak
 * access token stays server-side. This screen is deliberately read-only —
 * enable/disable happens per Site on `/sites/{id}/modules`, because a
 * registry row only says a capability *exists as a record*, never that it
 * works or that any particular site runs it.
 *
 * Availability is spelled out for every state: only an IMPLEMENTED module
 * that is switched on platform-wide can be enabled for a site (and the
 * backend still re-checks the capability is shipped); PLANNED modules —
 * including the seeded CMS, staff directory and events rows — cannot be
 * enabled anywhere, and saying so is the whole point of this screen.
 */
import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
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

import { listPlatformModules } from "@/app/sites/actions";
import { unwrap } from "@/organizations/contract";
import {
  MODULE_STATUS_OPTIONS,
  availabilityMessage,
  isModuleAvailable,
  moduleAvailabilityChip,
  moduleSchemaProperties,
  moduleStatusChip,
} from "@/modules/validation";

interface Filters {
  search: string;
  status: string;
}

export function ModuleRegistry() {
  const [filters, setFilters] = useState<Filters>({ search: "", status: "" });
  const [draft, setDraft] = useState<Filters>({ search: "", status: "" });
  const [page, setPage] = useState(1);

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
    [filters.search, filters.status, page],
  );

  const activeCount =
    (filters.search ? 1 : 0) + (filters.status ? 1 : 0);
  const modules = registry.data?.results ?? [];
  const filtered = activeCount > 0;

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
      header: "Registry status",
      render: (row) => {
        const chip = moduleStatusChip(row);
        return (
          <Chip size="small" variant="outlined" color={chip.color} label={chip.label} />
        );
      },
    },
    {
      field: "availability",
      header: "For sites",
      render: (row) => {
        const chip = moduleAvailabilityChip(row);
        return (
          <Chip size="small" variant="filled" color={chip.color} label={chip.label} />
        );
      },
    },
    {
      field: "is_enabled",
      header: "Platform switch",
      render: (row) => (row.is_enabled ? "On" : "Off"),
    },
    {
      field: "settings",
      header: "Settings",
      render: (row) => {
        const properties = moduleSchemaProperties(row);
        if (properties === null) return "Schema unapproved";
        return properties.length === 0
          ? "None"
          : `${properties.length} propert${properties.length === 1 ? "y" : "ies"}`;
      },
    },
  ];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Alert severity="info" variant="outlined">
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          A registry row is a capability announcement, not a working feature.
        </Typography>
        <Typography variant="body2">
          <strong>Available</strong> = implemented and switched on
          platform-wide, so a site may enable it (the server still verifies
          the capability is shipped). <strong>Planned</strong> = registered
          but not implemented — it cannot be enabled on any site.{" "}
          <strong>Deprecated</strong> = retired, not newly enableable.
          Implemented-but-off rows cannot be enabled until the platform switch
          is on. The switch and statuses are managed on the backend; this
          console only reads them.
        </Typography>
      </Alert>

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
          placeholder="CMS, analytics…"
          hint="Name or code substring."
        />
        <SelectFilter
          label="Status"
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
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Registered capabilities
          </Typography>
          <Typography variant="body2" color="text.secondary">
            The platform module registry exactly as the API reports it. To
            enable or disable a module for a specific site, open that
            site&apos;s Modules screen.
          </Typography>
        </Box>
        <DataTable
          caption="Platform module registry"
          columns={columns}
          rows={modules}
          getRowKey={(row) => row.id}
          loading={registry.loading}
          error={registry.error}
          onRetry={() => registry.reload()}
          emptyState={
            filtered ? (
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

      {modules.length > 0 ? (
        <Paper variant="outlined" sx={{ borderRadius: 3, p: { xs: 2, sm: 3 } }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            Availability detail
          </Typography>
          <Box
            component="ul"
            sx={{ m: 0, pl: 2, display: "flex", flexDirection: "column", gap: 0.75 }}
          >
            {modules.map((module) => (
              <li key={module.id}>
                <Typography variant="body2" color="text.secondary">
                  <Box component="span" sx={{ fontFamily: "monospace", fontWeight: 700 }}>
                    {module.code}
                  </Box>
                  {": "}
                  {availabilityMessage(module)}
                </Typography>
              </li>
            ))}
          </Box>
        </Paper>
      ) : null}
    </Box>
  );
}
