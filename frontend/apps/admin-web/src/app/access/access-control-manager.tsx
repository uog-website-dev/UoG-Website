"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AddIcon from "@mui/icons-material/Add";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import {
  assignRole,
  createRole,
  getAccessControlData,
  getUserEffectivePermissions,
  replaceRolePermissions,
  revokeRoleAssignment,
  updateRole,
} from "@/app/access/actions";
import type {
  AccessControlData,
  AccessScopeSelection,
  AccessSection,
  AssignmentDefinition,
  EffectiveGrant,
} from "@/app/access/actions";
import type { ApiErrorPayload } from "@/organizations/contract";

const CONTENT_ROLES = ["editor", "reviewer", "viewer"] as const;
const SITE_MEMBERSHIP_ROLE_CODES = new Set([
  "site-administrator",
  "editor",
  "publisher",
  "reviewer",
  "viewer",
]);

function Field(props: React.ComponentProps<typeof TextField>) {
  return <TextField size="small" fullWidth {...props} />;
}

function detailText(details: unknown): string | null {
  if (typeof details === "string" && details.trim()) return details.trim();
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const detail = (details as { detail?: unknown }).detail;
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  const sentences = Object.entries(details as Record<string, unknown>)
    .flatMap(([field, value]) => {
      const items = Array.isArray(value) ? value : [value];
      return items
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => `${field}: ${item.trim()}`);
    });
  return sentences.length ? sentences.join(" ") : null;
}

function failureText(error: ApiErrorPayload): string {
  const specific = detailText(error.details);
  const message = specific && specific !== error.message ? `${error.message} ${specific}` : error.message;
  return error.requestId ? `${message} Reference ${error.requestId}.` : message;
}

function SectionFailure({ error }: { error: ApiErrorPayload }) {
  return (
    <Typography color="error" role="alert">
      {failureText(error)}
    </Typography>
  );
}

function emptySection<T>(section: AccessSection<T> | null, empty: string, render: (data: T) => React.ReactNode) {
  if (!section) return <Typography color="text.secondary">Loading registered access data…</Typography>;
  if (section.status === "error") return <SectionFailure error={section.error} />;
  const data = section.data;
  const isEmpty = Array.isArray(data) ? data.length === 0 : false;
  if (isEmpty) return <Typography color="text.secondary">{empty}</Typography>;
  return render(data);
}

export function AccessControlManager() {
  const [data, setData] = useState<AccessControlData | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [selectedCode, setSelectedCode] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [roleActive, setRoleActive] = useState(false);
  const [newRole, setNewRole] = useState({ code: "", name: "", description: "" });
  const [userId, setUserId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [scope, setScope] = useState<"PLATFORM" | "ORGANIZATION" | "SITE">("SITE");
  const [organizationId, setOrganizationId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [inspection, setInspection] = useState<AccessScopeSelection>({ scope: "PLATFORM" });
  const [draftScope, setDraftScope] = useState<"PLATFORM" | "ORGANIZATION" | "SITE">("PLATFORM");
  const [draftOrganization, setDraftOrganization] = useState("");
  const [draftSite, setDraftSite] = useState("");
  const [inspected, setInspected] = useState<AccessSection<EffectiveGrant> | null>(null);

  const refresh = useCallback(async (scopeSelection?: AccessScopeSelection) => {
    const next = await getAccessControlData(scopeSelection ?? inspection);
    setData(next);
    return next;
  }, [inspection]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const permissions = data?.permissions.status === "ready" ? data.permissions.data : [];
  const roles = data?.roles.status === "ready" ? data.roles.data : [];
  const assignments = data?.assignments.status === "ready" ? data.assignments.data : [];
  const effective = data?.effective.status === "ready" ? data.effective.data : [];
  const selectedRole = roles.find((role) => role.code === selectedCode) ?? null;
  const activeRoles = useMemo(() => {
    const active = roles.filter((role) => role.is_active);
    if (scope === "SITE") return active.filter((role) => SITE_MEMBERSHIP_ROLE_CODES.has(role.code));
    return active;
  }, [roles, scope]);
  useEffect(() => {
    if (roleId && !activeRoles.some((role) => String(role.id) === roleId)) setRoleId("");
  }, [activeRoles, roleId]);
  const permissionsReady = data?.effective.status === "ready";
  const canCreateRoles = permissionsReady && effective.includes("platform.roles.create");
  const canUpdateRoles = permissionsReady && effective.includes("platform.roles.update");
  const canAssignPermissions = permissionsReady && effective.includes("platform.roles.assign_permissions");
  const canAssignRoles = permissionsReady && effective.includes("platform.users.assign_roles");
  const visibleAssignments = assignments.filter((assignment) => {
    if (inspection.scope === "PLATFORM") return assignment.scope === "PLATFORM";
    if (inspection.scope === "ORGANIZATION") {
      return assignment.scope === "ORGANIZATION" && assignment.organization === inspection.organization;
    }
    return assignment.scope === "SITE" && assignment.site === inspection.site;
  });

  useEffect(() => {
    if (selectedRole) {
      setSelectedPermissions(selectedRole.permissions);
      setRoleName(selectedRole.name);
      setRoleDescription(selectedRole.description);
      setRoleActive(selectedRole.is_active);
    } else {
      setSelectedPermissions([]);
      setRoleName("");
      setRoleDescription("");
      setRoleActive(false);
    }
  }, [selectedRole]);

  async function mutate(
    operation: () => Promise<{ ok: boolean; error?: ApiErrorPayload }>,
    success: string,
    nextScope?: AccessScopeSelection,
  ) {
    setPending(true);
    setNotice(null);
    try {
      const result = await operation();
      if (!result.ok) {
        setNotice({
          tone: "error",
          text: result.error ? failureText(result.error) : "The change was rejected.",
        });
        return false;
      }
      setNotice({ tone: "success", text: success });
      if (nextScope) setInspection(nextScope);
      await refresh(nextScope);
      return true;
    } catch {
      setNotice({ tone: "error", text: "The request could not be completed. Please try again." });
      return false;
    } finally {
      setPending(false);
    }
  }

  function selectionFromDraft(): AccessScopeSelection | null {
    const organization = draftOrganization ? Number(draftOrganization) : undefined;
    const site = draftSite ? Number(draftSite) : undefined;
    if (draftScope === "ORGANIZATION" && (!organization || !Number.isSafeInteger(organization) || organization < 1)) {
      setNotice({ tone: "error", text: "Enter the organization to inspect." });
      return null;
    }
    if (draftScope === "SITE" && (!site || !Number.isSafeInteger(site) || site < 1)) {
      setNotice({ tone: "error", text: "Enter the site to inspect." });
      return null;
    }
    return {
      scope: draftScope,
      ...(draftScope !== "PLATFORM" && organization ? { organization } : {}),
      ...(draftScope === "SITE" && site ? { site } : {}),
    };
  }

  async function applyScope(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = selectionFromDraft();
    if (!next) return;
    setInspection(next);
    setInspected(null);
    setNotice(null);
    await refresh(next);
  }

  async function inspectUser(targetUser: number, targetScope: AccessScopeSelection) {
    const result = await getUserEffectivePermissions(targetUser, targetScope);
    setInspected(result.ok ? { status: "ready", data: result.data } : { status: "error", error: result.error });
  }

  async function revokeAndRefresh(assignment: AssignmentDefinition) {
    const revokedScope: AccessScopeSelection = {
      scope: assignment.scope,
      ...(assignment.organization ? { organization: assignment.organization } : {}),
      ...(assignment.site ? { site: assignment.site } : {}),
    };
    const revoked = await mutate(
      () => revokeRoleAssignment(assignment.id),
      "Role assignment revoked.",
      revokedScope,
    );
    if (revoked) await inspectUser(assignment.user, revokedScope);
  }

  async function submitRole(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = newRole.code.trim().toLowerCase();
    const created = await mutate(
      () => createRole({ ...newRole, code }),
      "Custom role created.",
    );
    if (created) {
      setNewRole({ code: "", name: "", description: "" });
      setSelectedCode(code);
    }
  }

  async function saveRoleDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRole || selectedRole.is_system) return;
    await mutate(
      () => updateRole(selectedRole.code, {
        name: roleName.trim(),
        description: roleDescription.trim(),
        is_active: roleActive,
      }),
      "Role details saved.",
    );
  }

  async function savePermissions() {
    if (!selectedRole || selectedRole.is_system) return;
    await mutate(
      () => replaceRolePermissions(selectedRole.code, selectedPermissions),
      "Role permissions saved.",
    );
  }

  async function submitAssignment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const user = Number(userId);
    const role = Number(roleId);
    if (!Number.isSafeInteger(user) || user < 1 || !Number.isSafeInteger(role) || role < 1) {
      setNotice({ tone: "error", text: "Enter a valid existing user ID and select a role." });
      return;
    }
    const organization = organizationId ? Number(organizationId) : undefined;
    const site = siteId ? Number(siteId) : undefined;
    if (scope !== "PLATFORM" && (!organization || !Number.isSafeInteger(organization))) {
      setNotice({ tone: "error", text: "Enter a valid organization ID for this assignment scope." });
      return;
    }
    if (scope === "SITE" && (!site || !Number.isSafeInteger(site))) {
      setNotice({ tone: "error", text: "Enter a valid site ID for a site-scoped assignment." });
      return;
    }
    const assignedScope: AccessScopeSelection = {
      scope,
      ...(scope !== "PLATFORM" && organization ? { organization } : {}),
      ...(scope === "SITE" && site ? { site } : {}),
    };
    const result = await mutate(
      () => assignRole({
        user,
        role,
        scope,
        ...(scope !== "PLATFORM" ? { organization } : {}),
        ...(scope === "SITE" ? { site } : {}),
        ...(expiresAt ? { expires_at: new Date(expiresAt).toISOString() } : {}),
      }),
      "Role assigned.",
      assignedScope,
    );
    if (result) {
      setDraftScope(scope);
      setDraftOrganization(organization ? String(organization) : "");
      setDraftSite(site ? String(site) : "");
      await inspectUser(user, assignedScope);
      setUserId("");
      setRoleId("");
      setExpiresAt("");
    }
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {notice && (
        <Paper variant="outlined" role={notice.tone === "error" ? "alert" : "status"} sx={{ p: 1.5, borderColor: notice.tone === "error" ? "error.main" : "divider" }}>
          <Typography>{notice.text}</Typography>
        </Paper>
      )}

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>Scope</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Effective permissions and the assignment list below follow this scope. Platform is the signed-in administrator’s platform grant.
        </Typography>
        <Box component="form" onSubmit={applyScope} sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(4, 1fr)" }, gap: 1.5, alignItems: "center" }}>
          <FormControl size="small" fullWidth>
            <InputLabel id="inspection-scope-label">Scope</InputLabel>
            <Select labelId="inspection-scope-label" label="Scope" value={draftScope} onChange={(event) => setDraftScope(event.target.value as typeof draftScope)}>
              <MenuItem value="PLATFORM">Platform</MenuItem>
              <MenuItem value="ORGANIZATION">Organization</MenuItem>
              <MenuItem value="SITE">Site</MenuItem>
            </Select>
          </FormControl>
          {draftScope !== "PLATFORM" && (
            <Field label="Organization ID" type="number" value={draftOrganization} onChange={(event) => setDraftOrganization(event.target.value)} inputProps={{ min: 1 }} />
          )}
          {draftScope === "SITE" && (
            <Field label="Site ID" type="number" value={draftSite} onChange={(event) => setDraftSite(event.target.value)} inputProps={{ min: 1 }} required />
          )}
          <Button type="submit" variant="outlined" disabled={pending}>Show this scope</Button>
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="h6" sx={{ mb: 1.5 }}>Your effective permissions</Typography>
        {emptySection(
          data?.effective ?? null,
          "No effective permissions are granted for this scope.",
          (codes: string[]) => (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
              {[...codes].sort().map((code) => <Chip key={code} label={code} size="small" color="primary" variant="outlined" />)}
            </Box>
          ),
        )}
      </Paper>

      {canCreateRoles && (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>Create custom role</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Only registered application permissions can be assigned; system role templates are read-only.</Typography>
          <Box component="form" onSubmit={submitRole} sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 2fr auto" }, gap: 1.5, alignItems: "center" }}>
            <Field label="Stable role code" value={newRole.code} onChange={(event) => setNewRole((value) => ({ ...value, code: event.target.value }))} required inputProps={{ pattern: "[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*" }} />
            <Field label="Role name" value={newRole.name} onChange={(event) => setNewRole((value) => ({ ...value, name: event.target.value }))} required />
            <Field label="Description" value={newRole.description} onChange={(event) => setNewRole((value) => ({ ...value, description: event.target.value }))} />
            <Button type="submit" variant="contained" startIcon={<AddIcon />} disabled={pending}>Create role</Button>
          </Box>
        </Paper>
      )}

      <Paper variant="outlined" sx={{ p: 2.5, overflowX: "auto" }}>
        <Typography variant="h6" sx={{ mb: 1.5 }}>Roles and registered permissions</Typography>
        <Table size="small" aria-label="Roles and permissions">
          <TableHead><TableRow><TableCell>Role</TableCell><TableCell>Kind</TableCell><TableCell>State</TableCell><TableCell>Permissions</TableCell></TableRow></TableHead>
          <TableBody>
            {data?.roles.status === "error" && (
              <TableRow><TableCell colSpan={4}><SectionFailure error={data.roles.error} /></TableCell></TableRow>
            )}
            {data?.roles.status === "ready" && roles.map((role) => (
              <TableRow key={role.code} hover selected={role.code === selectedCode} onClick={() => setSelectedCode(role.code)} sx={{ cursor: "pointer" }}>
                <TableCell><strong>{role.name}</strong><br /><Typography variant="caption" color="text.secondary">{role.code}</Typography></TableCell>
                <TableCell>{role.is_system ? "Standard template" : "Custom"}</TableCell>
                <TableCell>{role.is_active ? "Active" : "Disabled"}</TableCell>
                <TableCell>{role.permissions.length ? role.permissions.join(", ") : "None"}</TableCell>
              </TableRow>
            ))}
            {data?.roles.status === "ready" && roles.length === 0 && <TableRow><TableCell colSpan={4}><Typography color="text.secondary">No roles are visible to this account.</Typography></TableCell></TableRow>}
            {!data && <TableRow><TableCell colSpan={4}><Typography color="text.secondary">Loading registered access data…</Typography></TableCell></TableRow>}
          </TableBody>
        </Table>
      </Paper>

      {selectedRole && (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>Manage {selectedRole.name}</Typography>
          {selectedRole.is_system ? (
            <Typography color="text.secondary">Standard role templates are managed through reviewed configuration. Create a custom role to customize its permissions.</Typography>
          ) : (
            <>
              {canUpdateRoles && <Box component="form" onSubmit={saveRoleDetails} sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 2fr auto auto" }, gap: 1.5, alignItems: "center", mb: 2 }}>
                <Field name="role-name" label="Role name" value={roleName} onChange={(event) => setRoleName(event.target.value)} required />
                <Field name="role-description" label="Description" value={roleDescription} onChange={(event) => setRoleDescription(event.target.value)} />
                <FormControlLabel control={<Checkbox checked={roleActive} onChange={(event) => setRoleActive(event.target.checked)} />} label="Active" />
                <Button type="submit" variant="outlined" disabled={pending}>Save details</Button>
              </Box>}
              {canAssignPermissions && <>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Permission assignments</Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "1fr 1fr 1fr" }, gap: 0.5, mb: 2 }}>
                  {permissions.filter((permission) => permission.is_active).map((permission) => (
                    <FormControlLabel
                      key={permission.code}
                      control={<Checkbox checked={selectedPermissions.includes(permission.code)} onChange={(event) => setSelectedPermissions((current) => event.target.checked ? [...current, permission.code] : current.filter((code) => code !== permission.code))} />}
                      label={<Box><Typography variant="body2">{permission.code}</Typography><Typography variant="caption" color="text.secondary">{permission.name} · {permission.risk}</Typography></Box>}
                    />
                  ))}
                </Box>
                <Button variant="contained" onClick={savePermissions} disabled={pending}>Save permissions</Button>
              </>}
              {!canUpdateRoles && !canAssignPermissions && <Typography color="text.secondary">Your current permissions allow viewing but not changing this role.</Typography>}
            </>
          )}
        </Paper>
      )}

      {canAssignRoles && <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>Assign a role</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Use the existing platform user ID and explicit scope identifiers. The API verifies delegation authority and scope ownership.</Typography>
        <Box component="form" onSubmit={submitAssignment} sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }, gap: 1.5 }}>
          <Field label="User ID" type="number" value={userId} onChange={(event) => setUserId(event.target.value)} inputProps={{ min: 1 }} required />
          <FormControl size="small" fullWidth required>
            <InputLabel id="role-assignment-label">Role</InputLabel>
            <Select labelId="role-assignment-label" label="Role" value={roleId} onChange={(event) => setRoleId(event.target.value)}>
              {activeRoles.map((role) => <MenuItem key={role.id} value={String(role.id)}>{role.name} ({role.code})</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth required>
            <InputLabel id="assignment-scope-label">Scope</InputLabel>
            <Select labelId="assignment-scope-label" label="Scope" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}>
              <MenuItem value="PLATFORM">Platform</MenuItem><MenuItem value="ORGANIZATION">Organization</MenuItem><MenuItem value="SITE">Site</MenuItem>
            </Select>
          </FormControl>
          {scope !== "PLATFORM" && <Field label="Organization ID" type="number" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} inputProps={{ min: 1 }} required />}
          {scope === "SITE" && <Field label="Site ID" type="number" value={siteId} onChange={(event) => setSiteId(event.target.value)} inputProps={{ min: 1 }} required />}
          <Field label="Expires at (optional)" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} InputLabelProps={{ shrink: true }} />
          <Button type="submit" variant="contained" disabled={pending || activeRoles.length === 0}>Assign role</Button>
        </Box>
      </Paper>}

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="h6" sx={{ mb: 1.5 }}>Editor, Reviewer and Viewer</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          These rows use the permission codes returned for the registered role templates.
        </Typography>
        {data?.roles.status === "error" && <SectionFailure error={data.roles.error} />}
        {data?.roles.status === "ready" && (
          <Table size="small" aria-label="Editor reviewer and viewer permissions">
            <TableHead><TableRow><TableCell>Role</TableCell><TableCell>Registered permissions</TableCell></TableRow></TableHead>
            <TableBody>
              {CONTENT_ROLES.map((code) => {
                const role = roles.find((item) => item.code === code);
                return (
                  <TableRow key={code}>
                    <TableCell>{role?.name ?? code}</TableCell>
                    <TableCell>{role ? (role.permissions.length ? role.permissions.join(", ") : "None") : "This role was not returned."}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {!data && <Typography color="text.secondary">Loading registered access data…</Typography>}
      </Paper>

      {inspected && (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="h6" sx={{ mb: 1.5 }}>Effective permissions after the assignment change</Typography>
          {inspected.status === "error"
            ? <SectionFailure error={inspected.error} />
            : inspected.data.permissions.length
              ? (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }} aria-label="Inspected effective permissions">
                  {[...inspected.data.permissions].sort().map((code) => <Chip key={code} label={code} size="small" />)}
                </Box>
              )
              : <Typography color="text.secondary">No effective permissions are granted to this user for the selected scope.</Typography>}
        </Paper>
      )}

      <Paper variant="outlined" sx={{ p: 2.5, overflowX: "auto" }}>
        <Typography variant="h6" sx={{ mb: 1.5 }}>User role assignments</Typography>
        {data?.assignments.status === "error" && <SectionFailure error={data.assignments.error} />}
        {data?.assignments.status === "ready" && (
          <Table size="small" aria-label="User role assignments">
            <TableHead><TableRow><TableCell>User</TableCell><TableCell>Role</TableCell><TableCell>Scope</TableCell><TableCell>Expires</TableCell><TableCell>Status</TableCell><TableCell align="right">Action</TableCell></TableRow></TableHead>
            <TableBody>
              {visibleAssignments.map((assignment) => (
                <TableRow key={assignment.id}>
                  <TableCell>{assignment.user_name} <Typography component="span" variant="caption" color="text.secondary">(#{assignment.user})</Typography></TableCell>
                  <TableCell>{assignment.role_name}</TableCell>
                  <TableCell>{assignment.scope}{assignment.organization ? ` · org ${assignment.organization}` : ""}{assignment.site ? ` · site ${assignment.site}` : ""}</TableCell>
                  <TableCell>{assignment.expires_at ? new Date(assignment.expires_at).toLocaleString() : "Never"}</TableCell>
                  <TableCell>{assignment.revoked_at ? "Revoked" : "Active"}</TableCell>
                  <TableCell align="right">{canAssignRoles && !assignment.revoked_at && (
                    <Button
                      size="small"
                      color="error"
                      disabled={pending}
                      onClick={() => void revokeAndRefresh(assignment)}
                    >
                      Revoke
                    </Button>
                  )}</TableCell>
                </TableRow>
              ))}
              {visibleAssignments.length === 0 && <TableRow><TableCell colSpan={6}><Typography color="text.secondary">No assignments are visible in the selected scope.</Typography></TableCell></TableRow>}
            </TableBody>
          </Table>
        )}
        {!data && <Typography color="text.secondary">Loading registered access data…</Typography>}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5, overflowX: "auto" }}>
        <Typography variant="h6" sx={{ mb: 1.5 }}>Registered permission catalog</Typography>
        <Table size="small" aria-label="Registered permission catalog">
          <TableHead><TableRow><TableCell>Code</TableCell><TableCell>Name and action</TableCell><TableCell>Module / resource</TableCell><TableCell>Risk</TableCell><TableCell>Delegable</TableCell></TableRow></TableHead>
          <TableBody>
            {data?.permissions.status === "error" && (
              <TableRow><TableCell colSpan={5}><SectionFailure error={data.permissions.error} /></TableCell></TableRow>
            )}
            {data?.permissions.status === "ready" && permissions.map((permission) => (
              <TableRow key={permission.code}>
                <TableCell><code>{permission.code}</code></TableCell>
                <TableCell><strong>{permission.name}</strong><br /><Typography variant="caption" color="text.secondary">{permission.description}</Typography></TableCell>
                <TableCell>{permission.module} / {permission.resource_type} · {permission.action}</TableCell>
                <TableCell>{permission.risk}</TableCell>
                <TableCell>{permission.delegable ? "Yes" : "No"}</TableCell>
              </TableRow>
            ))}
            {data?.permissions.status === "ready" && permissions.length === 0 && (
              <TableRow><TableCell colSpan={5}><Typography color="text.secondary">No permissions are registered.</Typography></TableCell></TableRow>
            )}
            {!data && <TableRow><TableCell colSpan={5}><Typography color="text.secondary">Loading registered access data…</Typography></TableCell></TableRow>}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}
