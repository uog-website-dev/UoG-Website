"use client";

/**
 * User Assignment & Access Management.
 *
 * Three panels, all reading through server actions so the Keycloak access
 * token stays server-side:
 *
 *   1. user search — find an existing Keycloak account by username, email
 *      or name (the lookup is backend-backed; a mock is used only in local
 *      development, and a production build refuses mock mode outright);
 *   2. for the selected user — the backend-computed *effective permissions*
 *      summary and their assignment list, with revoke behind a confirmation;
 *   3. the append-only audit trail of recent assignment changes.
 *
 * Authorization: `getCallerAccess` reports what the signed-in administrator
 * may manage, and the screen offers only those roles and scopes. That is a
 * usability boundary — every write still goes to the backend, which
 * re-checks the caller's authority and whose 403/409/412 answers are shown
 * verbatim. The frontend never substitutes for those checks.
 */
import { useState } from "react";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import AdminPanelSettingsRoundedIcon from "@mui/icons-material/AdminPanelSettingsRounded";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { ROLE_CATALOG } from "@uog/api-client";
import type {
  AssignmentAuditEvent,
  CallerAccess,
  EffectiveAccess,
  PaginatedResponse,
  PlatformRole,
  PlatformUser,
  UserAssignment,
} from "@uog/types";
import {
  ApiErrorState,
  ConfirmDialog,
  DataTable,
  EmptyState,
  FilterBar,
  LoadingState,
  TextFilter,
  useAsync,
  useToast,
} from "@uog/ui";
import type { TableColumn } from "@uog/ui";
import { ApiError } from "@uog/api-client";

import {
  getCallerAccess,
  getEffectiveAccess,
  listAssignmentAudit,
  listAssignments,
  revokeAssignment,
  searchUsers,
} from "@/app/access/actions";
import {
  deserializeApiError,
  isOk,
  unwrap,
} from "@/organizations/contract";
import { AssignDialog } from "@/access/assign-dialog";

const SCOPE_TYPE_LABELS = {
  PLATFORM: "Platform",
  SITE: "Site",
  ORGANIZATION: "Organization",
} as const;

const AUDIT_ACTION_LABELS: Record<string, string> = {
  "assignment.created": "Role assigned",
  "assignment.revoked": "Role revoked",
};

function roleLabel(role: PlatformRole): string {
  return ROLE_CATALOG.find((entry) => entry.code === role)?.label ?? role;
}

function roleChip(role: PlatformRole) {
  const color =
    role === "platform-admin"
      ? "primary"
      : role === "platform-editor"
        ? "info"
        : "default";
  return <Chip size="small" variant="outlined" color={color} label={roleLabel(role)} />;
}

function scopeChip(type: keyof typeof SCOPE_TYPE_LABELS) {
  const color =
    type === "PLATFORM"
      ? "primary"
      : type === "SITE"
        ? "info"
        : "secondary";
  return (
    <Chip size="small" variant="outlined" color={color} label={SCOPE_TYPE_LABELS[type]} />
  );
}

/** ISO date rendered as a stable, locale-independent YYYY-MM-DD. */
function formatDate(value: string): string {
  return value.slice(0, 10);
}

/**
 * The backend refused the read outright (403): this administrator is not
 * authorized to manage access at all. Shown instead of any data, and never
 * softened into an empty state — "nothing to manage" and "you may not
 * manage" are different facts.
 */
function PermissionDenied({ message }: { message?: string }) {
  return (
    <Paper
      variant="outlined"
      role="alert"
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 1.5,
        py: { xs: 6, sm: 8 },
        px: 3,
        textAlign: "center",
      }}
    >
      <AdminPanelSettingsRoundedIcon fontSize="large" color="disabled" />
      <Typography variant="h6" sx={{ fontWeight: 700 }}>
        Permission denied
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520 }}>
        {message ??
          "You do not have permission to manage user access."}{" "}
        Role assignments are restricted to platform administrators — ask an
        administrator to grant you access if you need it.
      </Typography>
    </Paper>
  );
}

export function AccessScreen() {
  const toast = useToast();

  // 1. Who am I, and what may I manage? The backend answers this; the
  //    screen only renders it.
  const caller = useAsync<CallerAccess>(
    async () => unwrap(await getCallerAccess()),
    [],
  );

  // 2. User search (applied on submit, like every other filter bar).
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const users = useAsync<PaginatedResponse<PlatformUser>>(
    async () => unwrap(await searchUsers({ search })),
    [search],
    { isEmpty: (data) => data.count === 0 },
  );

  const [selected, setSelected] = useState<PlatformUser | null>(null);
  // Bumped after every mutation so the dependent reads reload together.
  const [refresh, setRefresh] = useState(0);

  const effective = useAsync<EffectiveAccess | null>(
    async () =>
      selected ? unwrap(await getEffectiveAccess(selected.id)) : null,
    [selected?.id, refresh],
    { isEmpty: (data) => (data?.permissions.length ?? 0) === 0 },
  );

  const assignments = useAsync<PaginatedResponse<UserAssignment> | null>(
    async () =>
      selected
        ? unwrap(await listAssignments({ user: selected.id, ordering: "-created_at" }))
        : null,
    [selected?.id, refresh],
    { isEmpty: (data) => (data?.count ?? 0) === 0 },
  );

  const audit = useAsync<PaginatedResponse<AssignmentAuditEvent>>(
    async () => unwrap(await listAssignmentAudit()),
    [refresh],
    { isEmpty: (data) => data.count === 0 },
  );

  // 3. Mutations.
  const [assignOpen, setAssignOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<UserAssignment | null>(null);
  const [revokePending, setRevokePending] = useState(false);
  const [revokeError, setRevokeError] = useState<ApiError | null>(null);

  const confirmRevoke = async () => {
    if (!revokeTarget || revokePending) return;
    setRevokePending(true);
    setRevokeError(null);
    const result = await revokeAssignment(revokeTarget.id);
    setRevokePending(false);
    if (isOk(result)) {
      toast.success(`Access revoked for ${revokeTarget.username}.`);
      setRevokeTarget(null);
      setRefresh((value) => value + 1);
      return;
    }
    setRevokeError(deserializeApiError(result.error));
  };

  if (caller.status !== "error" && !caller.data) {
    return <LoadingState label="Checking your access permissions…" />;
  }
  if (caller.status === "error" && caller.error) {
    if (caller.error.status === 403) {
      return <PermissionDenied message={caller.error.message} />;
    }
    return (
      <ApiErrorState
        error={caller.error}
        onRetry={caller.reload}
        title="Access information unavailable"
      />
    );
  }

  const access = caller.data as CallerAccess;
  const canAssign =
    access.assignable_roles.length > 0 && access.manageable_scopes.length > 0;

  const canManageScope = (assignment: UserAssignment) =>
    access.manageable_scopes.some(
      (scope) =>
        scope.type === assignment.scope_type && scope.id === assignment.scope_id,
    );

  const userColumns: TableColumn<PlatformUser>[] = [
    { field: "username", header: "Username", render: (user) => user.username },
    {
      field: "name",
      header: "Name",
      render: (user) => `${user.first_name} ${user.last_name}`,
    },
    { field: "email", header: "Email", render: (user) => user.email },
    {
      field: "status",
      header: "Status",
      render: (user) => (
        <Chip
          size="small"
          label={user.enabled ? "Enabled" : "Disabled"}
          color={user.enabled ? "success" : "default"}
        />
      ),
    },
  ];

  const effectiveColumns: TableColumn<EffectiveAccess["permissions"][number]>[] = [
    {
      field: "role",
      header: "Role",
      render: (permission) => roleChip(permission.role),
    },
    {
      field: "scope",
      header: "Scope",
      render: (permission) => (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="body2">{permission.scope_label}</Typography>
          {scopeChip(permission.scope_type)}
        </Box>
      ),
    },
    {
      field: "permissions",
      header: "Effective permissions",
      render: (permission) => (
        <Typography variant="body2" color="text.secondary">
          {permission.permissions.join(", ")}
        </Typography>
      ),
    },
  ];

  const assignmentColumns: TableColumn<UserAssignment>[] = [
    {
      field: "role",
      header: "Role",
      render: (assignment) => roleChip(assignment.role),
    },
    {
      field: "scope",
      header: "Scope",
      render: (assignment) => (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="body2">{assignment.scope_label}</Typography>
          {scopeChip(assignment.scope_type)}
        </Box>
      ),
    },
    {
      field: "created_by",
      header: "Granted by",
      render: (assignment) => assignment.created_by,
    },
    {
      field: "created_at",
      header: "Granted",
      render: (assignment) => formatDate(assignment.created_at),
    },
  ];

  const auditColumns: TableColumn<AssignmentAuditEvent>[] = [
    {
      field: "action",
      header: "Action",
      render: (event) => (
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {AUDIT_ACTION_LABELS[event.action] ?? event.action}
        </Typography>
      ),
    },
    { field: "actor", header: "Actor", render: (event) => event.actor_id },
    {
      field: "entity",
      header: "Assignment",
      render: (event) => `#${event.entity_id}`,
    },
    {
      field: "timestamp",
      header: "Time",
      render: (event) => formatDate(event.timestamp),
    },
  ];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {/* --- Panel 1: find a user ------------------------------------ */}
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700, mb: 0.5 }}>
          Find a user
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Search the identity provider&apos;s accounts by username, email or
          name, then open an account to see what it may reach and to manage
          its role assignments.
        </Typography>

        <FilterBar
          label="User filters"
          activeCount={search ? 1 : 0}
          resetDisabled={false}
          onApply={() => setSearch(draftSearch)}
          onReset={() => {
            setDraftSearch("");
            setSearch("");
          }}
        >
          <TextFilter
            label="Search users"
            value={draftSearch}
            onChange={setDraftSearch}
            placeholder="username, email or name"
            hint="Matching is a case-insensitive substring search."
          />
        </FilterBar>

        <Box sx={{ mt: 2 }}>
          <DataTable
            caption="Platform users matching the search"
            columns={userColumns}
            rows={users.data?.results ?? []}
            getRowKey={(user) => user.id}
            loading={users.loading}
            error={users.error}
            onRetry={users.reload}
            emptyState={
              <EmptyState
                title="No users found"
                description={
                  search
                    ? "No account matches this search. Try a shorter fragment of the username, email or name."
                    : "No accounts are visible to you."
                }
              />
            }
            renderActions={(user) =>
              selected?.id === user.id ? (
                <Chip size="small" color="primary" label="Selected" />
              ) : (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setSelected(user)}
                  aria-label={`View access for ${user.username}`}
                >
                  View access
                </Button>
              )
            }
          />
        </Box>
      </Paper>

      {/* --- Panel 2: effective access + assignments ------------------ */}
      {selected ? (
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 2,
              mb: 2,
            }}
          >
            <Box>
              <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
                Access for {selected.username}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {selected.first_name} {selected.last_name} · {selected.email}
                {selected.enabled ? "" : " · account disabled"}
              </Typography>
            </Box>
            <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
              <Button
                variant="contained"
                startIcon={<AddRoundedIcon />}
                disabled={!canAssign}
                onClick={() => setAssignOpen(true)}
                aria-describedby={canAssign ? undefined : "assign-disabled-note"}
              >
                Assign role
              </Button>
            </Box>
          </Box>

          {!canAssign ? (
            <Typography
              id="assign-disabled-note"
              variant="body2"
              color="text.secondary"
              sx={{ mb: 2 }}
            >
              Read-only view: your account has no roles you may grant or
              scopes you manage, so assignments cannot be changed here.
            </Typography>
          ) : null}

          {/* Effective permissions (backend-computed, displayed as-is). */}
          <Typography
            variant="subtitle1"
            component="h3"
            sx={{ fontWeight: 700, mt: 1 }}
          >
            Effective permissions
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            Computed by the backend from this user&apos;s assignments — the
            console never derives access itself.
          </Typography>
          <DataTable
            caption={`Effective permissions of ${selected.username}`}
            columns={effectiveColumns}
            rows={effective.data?.permissions ?? []}
            getRowKey={(permission) =>
              `${permission.role}-${permission.scope_type}-${permission.scope_id}`
            }
            loading={effective.loading}
            error={effective.error}
            onRetry={effective.reload}
            emptyState={
              <EmptyState
                title="No access granted"
                description="This account holds no role assignments, so it has no effective permissions."
              />
            }
          />

          {/* Assignments, with revoke inside the caller's managed scopes. */}
          <Typography
            variant="subtitle1"
            component="h3"
            sx={{ fontWeight: 700, mt: 3, mb: 1 }}
          >
            Role assignments
          </Typography>
          <DataTable
            caption={`Role assignments of ${selected.username}`}
            columns={assignmentColumns}
            rows={assignments.data?.results ?? []}
            getRowKey={(assignment) => assignment.id}
            loading={assignments.loading}
            error={assignments.error}
            onRetry={assignments.reload}
            emptyState={
              <EmptyState
                title="No assignments yet"
                description="This user has not been granted a role in any scope."
              />
            }
            renderActions={(assignment) =>
              canManageScope(assignment) ? (
                <Button
                  size="small"
                  color="error"
                  variant="outlined"
                  onClick={() => {
                    setRevokeError(null);
                    setRevokeTarget(assignment);
                  }}
                  aria-label={`Revoke ${roleLabel(assignment.role)} for ${assignment.username}`}
                >
                  Revoke
                </Button>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  Not in your scope
                </Typography>
              )
            }
          />
        </Paper>
      ) : null}

      {/* --- Panel 3: audit trail ------------------------------------- */}
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700, mb: 0.5 }}>
          Recent access changes
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Append-only audit entries for role assignments. Every entry keeps the
          correlation id of the request that produced it.
        </Typography>
        <DataTable
          caption="Recent role assignment audit entries"
          columns={auditColumns}
          rows={audit.data?.results ?? []}
          getRowKey={(event) => event.id}
          loading={audit.loading}
          error={audit.error}
          onRetry={audit.reload}
          emptyState={
            <EmptyState
              title="No audit entries yet"
              description="Assignment changes will appear here once any have been made."
            />
          }
        />
      </Paper>

      {/* --- Assign dialog -------------------------------------------- */}
      {selected && assignOpen ? (
        <AssignDialog
          open={assignOpen}
          user={selected}
          caller={access}
          onClose={() => setAssignOpen(false)}
          onSaved={() => setRefresh((value) => value + 1)}
        />
      ) : null}

      {/* --- Revoke confirmation -------------------------------------- */}
      <ConfirmDialog
        open={revokeTarget !== null}
        title="Revoke this access?"
        description={
          revokeTarget ? (
            <>
              <strong>{revokeTarget.username}</strong> will lose{" "}
              <strong>{roleLabel(revokeTarget.role)}</strong> in{" "}
              <strong>{revokeTarget.scope_label}</strong>. Grants in other
              scopes are not affected, and a new assignment can be created
              later.
            </>
          ) : (
            ""
          )
        }
        confirmLabel="Revoke access"
        confirmColor="error"
        pending={revokePending}
        error={revokeError}
        onConfirm={confirmRevoke}
        onCancel={() => {
          if (revokePending) return;
          setRevokeTarget(null);
          setRevokeError(null);
        }}
      />
    </Box>
  );
}
