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
  replaceRolePermissions,
  revokeRoleAssignment,
  updateRole,
} from "@/app/access/actions";
import type {
  AssignmentDefinition,
  PermissionDefinition,
  RoleDefinition,
} from "@/app/access/actions";

function Field(props: React.ComponentProps<typeof TextField>) {
  return <TextField size="small" fullWidth {...props} />;
}

export function AccessControlManager() {
  const [permissions, setPermissions] = useState<PermissionDefinition[]>([]);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [assignments, setAssignments] = useState<AssignmentDefinition[]>([]);
  const [effective, setEffective] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [selectedCode, setSelectedCode] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [roleActive, setRoleActive] = useState(false);
  const [newRole, setNewRole] = useState({ code: "", name: "", description: "" });
  const [userId, setUserId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [scope, setScope] = useState<"PLATFORM" | "ORGANIZATION" | "SITE">("ORGANIZATION");
  const [organizationId, setOrganizationId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const refresh = useCallback(async () => {
    const data = await getAccessControlData();
    setPermissions(data.permissions);
    setRoles(data.roles);
    setAssignments(data.assignments);
    setEffective(data.effective);
    setErrors(data.errors);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedRole = roles.find((role) => role.code === selectedCode) ?? null;
  const activeRoles = useMemo(() => roles.filter((role) => role.is_active), [roles]);
  const canCreateRoles = effective.includes("platform.roles.create");
  const canUpdateRoles = effective.includes("platform.roles.update");
  const canAssignPermissions = effective.includes("platform.roles.assign_permissions");
  const canAssignRoles = effective.includes("platform.users.assign_roles");
  const canViewAssignments = effective.includes("platform.users.view");

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

  async function mutate(operation: () => Promise<{ ok: boolean; error?: { message: string } }>, success: string) {
    setPending(true);
    setMessage("");
    try {
      const result = await operation();
      if (!result.ok) {
        setMessage(result.error?.message ?? "The change was rejected.");
        return false;
      }
      setMessage(success);
      await refresh();
      return true;
    } catch {
      setMessage("The request could not be completed. Please try again.");
      return false;
    } finally {
      setPending(false);
    }
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
      setMessage("Enter a valid existing user ID and select a role.");
      return;
    }
    const organization = organizationId ? Number(organizationId) : undefined;
    const site = siteId ? Number(siteId) : undefined;
    if (scope !== "PLATFORM" && (!organization || !Number.isSafeInteger(organization))) {
      setMessage("Enter a valid organization ID for this assignment scope.");
      return;
    }
    if (scope === "SITE" && (!site || !Number.isSafeInteger(site))) {
      setMessage("Enter a valid site ID for a site-scoped assignment.");
      return;
    }
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
    );
    if (result) {
      setUserId("");
      setRoleId("");
      setExpiresAt("");
    }
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {errors.length > 0 && (
        <Paper variant="outlined" role="status" sx={{ p: 2, borderColor: "warning.main" }}>
          <Typography variant="subtitle2">Some access-control data is unavailable</Typography>
          <Typography variant="body2" color="text.secondary">{errors.join(" · ")}</Typography>
        </Paper>
      )}
      {message && <Paper variant="outlined" role="status" sx={{ p: 1.5 }}><Typography>{message}</Typography></Paper>}

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="h6" sx={{ mb: 1.5 }}>Your effective permissions</Typography>
        {effective.length ? (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
            {[...effective].sort().map((code) => <Chip key={code} label={code} size="small" color="primary" variant="outlined" />)}
          </Box>
        ) : <Typography color="text.secondary">No effective permissions are granted for your platform scope.</Typography>}
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
            {roles.map((role) => (
              <TableRow key={role.code} hover selected={role.code === selectedCode} onClick={() => setSelectedCode(role.code)} sx={{ cursor: "pointer" }}>
                <TableCell><strong>{role.name}</strong><br /><Typography variant="caption" color="text.secondary">{role.code}</Typography></TableCell>
                <TableCell>{role.is_system ? "Standard template" : "Custom"}</TableCell>
                <TableCell>{role.is_active ? "Active" : "Disabled"}</TableCell>
                <TableCell>{role.permissions.length ? role.permissions.join(", ") : "None"}</TableCell>
              </TableRow>
            ))}
            {roles.length === 0 && <TableRow><TableCell colSpan={4}><Typography color="text.secondary">No roles are visible to this account.</Typography></TableCell></TableRow>}
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

      {canViewAssignments && <Paper variant="outlined" sx={{ p: 2.5, overflowX: "auto" }}>
        <Typography variant="h6" sx={{ mb: 1.5 }}>User role assignments</Typography>
        <Table size="small" aria-label="User role assignments">
          <TableHead><TableRow><TableCell>User</TableCell><TableCell>Role</TableCell><TableCell>Scope</TableCell><TableCell>Expires</TableCell><TableCell>Status</TableCell><TableCell align="right">Action</TableCell></TableRow></TableHead>
          <TableBody>
            {assignments.map((assignment) => (
              <TableRow key={assignment.id}>
                <TableCell>{assignment.user_name} <Typography component="span" variant="caption" color="text.secondary">(#{assignment.user})</Typography></TableCell>
                <TableCell>{assignment.role_name}</TableCell>
                <TableCell>{assignment.scope}{assignment.organization ? ` · org ${assignment.organization}` : ""}{assignment.site ? ` · site ${assignment.site}` : ""}</TableCell>
                <TableCell>{assignment.expires_at ? new Date(assignment.expires_at).toLocaleString() : "Never"}</TableCell>
                <TableCell>{assignment.revoked_at ? "Revoked" : "Active"}</TableCell>
                <TableCell align="right">{canAssignRoles && !assignment.revoked_at && <Button size="small" color="error" disabled={pending} onClick={() => void mutate(() => revokeRoleAssignment(assignment.id), "Role assignment revoked.")}>Revoke</Button>}</TableCell>
              </TableRow>
            ))}
            {assignments.length === 0 && <TableRow><TableCell colSpan={6}><Typography color="text.secondary">No assignments are visible in your authorized scope.</Typography></TableCell></TableRow>}
          </TableBody>
        </Table>
      </Paper>}

      <Paper variant="outlined" sx={{ p: 2.5, overflowX: "auto" }}>
        <Typography variant="h6" sx={{ mb: 1.5 }}>Registered permission catalog</Typography>
        <Table size="small" aria-label="Registered permission catalog">
          <TableHead><TableRow><TableCell>Code</TableCell><TableCell>Name and action</TableCell><TableCell>Module / resource</TableCell><TableCell>Risk</TableCell><TableCell>Delegable</TableCell></TableRow></TableHead>
          <TableBody>
            {permissions.map((permission) => (
              <TableRow key={permission.code}>
                <TableCell><code>{permission.code}</code></TableCell>
                <TableCell><strong>{permission.name}</strong><br /><Typography variant="caption" color="text.secondary">{permission.description}</Typography></TableCell>
                <TableCell>{permission.module} / {permission.resource_type} · {permission.action}</TableCell>
                <TableCell>{permission.risk}</TableCell>
                <TableCell>{permission.delegable ? "Yes" : "No"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}
