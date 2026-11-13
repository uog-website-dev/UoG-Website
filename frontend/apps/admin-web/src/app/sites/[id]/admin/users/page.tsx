"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "@mui/material/Avatar";
import { SiteUserCreate } from "@/sites/site-user-create";
import AddIcon from "@mui/icons-material/PersonAddAlt1";
import SearchIcon from "@mui/icons-material/Search";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TablePagination from "@mui/material/TablePagination";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useParams } from "next/navigation";

import { SiteSection, useSiteAdmin } from "@/sites/site-admin-frame";
import { isSiteMembershipRole } from "@/sites/site-membership";
import { assignSiteRole, getSiteRoles, getSiteUsers, revokeSiteRole, searchSiteUsers } from "@/app/sites/user-actions";
import type { SiteAssignment, SiteDirectoryUser, SiteIdentity, SiteRole } from "@/app/sites/user-actions";

export default function SiteUsersPage() {
  const params=useParams<{id:string}>();
  return <SiteSection sectionKey="users"><UsersDirectory key={params.id} /></SiteSection>;
}

function UsersDirectory() {
  const { site } = useSiteAdmin();
  const params = useParams<{ id: string }>();
  const siteId = Number(params.id);
  const [revision,setRevision]=useState(0);
  const generation=useRef(0);
  const [people, setPeople] = useState<SiteDirectoryUser[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [ordering, setOrdering] = useState("name");
  const [roles, setRoles] = useState<SiteRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState(false);
  const [creating,setCreating]=useState(false);
  const [needle, setNeedle] = useState("");
  const [identities, setIdentities] = useState<SiteIdentity[]>([]);
  const [selected, setSelected] = useState<SiteIdentity | null>(null);
  const [roleId, setRoleId] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<SiteAssignment | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const requestGeneration=++generation.current;
    setLoading(true); setError("");
    try {
      const [directory, availableRoles] = await Promise.all([getSiteUsers(siteId, search, page + 1, filter, ordering), getSiteRoles(siteId)]);
      if(requestGeneration!==generation.current)return;
      setPeople(directory.results); setCount(directory.count); setRoles(availableRoles.filter((role) => isSiteMembershipRole(role.code)));
    } catch (cause) { if(requestGeneration===generation.current)setError(cause instanceof Error ? cause.message : "Could not load Site users."); }
    finally { if(requestGeneration===generation.current)setLoading(false); }
  }, [filter, ordering, page, search, siteId,revision]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!dialog || needle.trim().length < 2) { setIdentities([]); return; }
    let current = true;
    const timer = setTimeout(() => void searchSiteUsers(siteId, needle).then((items) => { if (current) setIdentities(items); }).catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : "User search failed."); }), 250);
    return () => { current = false; clearTimeout(timer); };
  }, [dialog, needle, siteId]);

  const add = async () => {
    if (!selected || roleId === "") return;
    setBusy(true); setError("");
    try {
      await assignSiteRole(siteId, site.organizationId!, selected.id, roleId);
      setNotice(`Added ${selected.username} to ${site.name}.`); setDialog(false); setSelected(null); setNeedle(""); setRoleId(""); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not assign the role."); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!confirming) return;
    setBusy(true); setError("");
    try { await revokeSiteRole(confirming.id); setNotice(`Removed ${confirming.role_name} access.`); setConfirming(null); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not remove the assignment."); }
    finally { setBusy(false); }
  };

  return <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
    <Box sx={{ display: "flex", alignItems: { xs: "stretch", sm: "center" }, justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
      <Box><Typography variant="h4" component="h2" fontWeight={800}>Users</Typography><Typography color="text.secondary">Assign Site Admin, Editor, Publisher, Reviewer, or Viewer for {site.name}. Platform and organization roles are managed outside this Site.</Typography></Box>
      {roles.some(role=>role.assignable) ? <Stack direction="row" gap={1} flexWrap="wrap"><Button variant="outlined" startIcon={<AddIcon />} onClick={() => { setError(""); setDialog(true); }}>Add existing user</Button><Button variant="contained" onClick={()=>setCreating(true)}>Create user</Button></Stack> : null}
    </Box>
    {notice ? <Alert severity="success" onClose={() => setNotice("")}>{notice}</Alert> : null}
    {error ? <Alert severity="error" onClose={() => setError("")}>{error}</Alert> : null}
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
      <Stack direction={{ xs: "column", sm: "row" }} gap={1.5}>
        <TextField size="small" fullWidth label="Search name, email or username" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} InputProps={{ endAdornment: <SearchIcon fontSize="small" color="action" /> }} />
        <Select size="small" displayEmpty value={filter} onChange={(event) => { setFilter(event.target.value); setPage(0); }} sx={{ minWidth: 190 }} aria-label="Filter by role">
          <MenuItem value="">All roles</MenuItem>{roles.map((role) => <MenuItem key={role.id} value={String(role.id)}>{role.name}</MenuItem>)}
        </Select>
        <Select size="small" value={ordering} onChange={(event) => { setOrdering(event.target.value); setPage(0); }} sx={{ minWidth: 190 }} aria-label="Sort users">
          <MenuItem value="name">Name A–Z</MenuItem><MenuItem value="-name">Name Z–A</MenuItem><MenuItem value="-assigned_at">Recently assigned</MenuItem><MenuItem value="assigned_at">Oldest assignment</MenuItem>
        </Select>
      </Stack>
    </Paper>
    <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3 }}>
      <Table aria-label="Site users" size="medium">
        <TableHead><TableRow><TableCell>User</TableCell><TableCell>Username</TableCell><TableCell>Roles</TableCell><TableCell>Assigned</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
        <TableBody>
          {loading ? <TableRow><TableCell colSpan={5} align="center"><CircularProgress size={24} aria-label="Loading users" /></TableCell></TableRow> : null}
          {!loading && people.length === 0 ? <TableRow><TableCell colSpan={5} align="center"><Typography color="text.secondary" sx={{ py: 3 }}>No users are assigned to this Site or no users match the filter.</Typography></TableCell></TableRow> : null}
          {!loading && people.map((person) => <TableRow key={person.user} hover>
            <TableCell><Box sx={{display:"flex",alignItems:"center",gap:1.5}}><Avatar src={person.profile_picture || undefined} alt="" /> <Box><Typography fontWeight={650}>{[person.user_first_name, person.user_last_name].filter(Boolean).join(" ") || person.user_name}</Typography><Typography variant="body2" color="text.secondary">{person.user_email || "No email on record"}</Typography></Box></Box></TableCell>
            <TableCell>{person.user_name}</TableCell>
            <TableCell><Stack direction="row" gap={0.75} flexWrap="wrap">{person.assignments.map((assignment) => <Chip key={assignment.id} size="small" label={assignment.role_name} onDelete={roles.some(role=>role.assignable) ? ()=>setConfirming(assignment) : undefined} />)}</Stack></TableCell>
            <TableCell>{person.assignments.map((assignment) => <Typography key={assignment.id} variant="body2">{new Date(assignment.assigned_at).toLocaleDateString()}</Typography>)}</TableCell>
            <TableCell align="right">{roles.some(role=>role.assignable) ? person.assignments.map((assignment) => <IconButton key={assignment.id} size="small" aria-label={`Remove ${assignment.role_name} from ${person.user_name}`} title={`Remove ${assignment.role_name}`} onClick={() => setConfirming(assignment)}>×</IconButton>) : null}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
      <TablePagination component="div" count={count} page={page} onPageChange={(_, next) => setPage(next)} rowsPerPage={20} rowsPerPageOptions={[20]} />
    </TableContainer>

    {creating ? <SiteUserCreate siteId={siteId} siteName={site.name} roles={roles} onClose={()=>setCreating(false)} onCreated={username=>{setCreating(false);setNotice(`Created ${username} and assigned their Site role.`);setSearch("");setFilter("");setPage(0);setRevision(value=>value+1);}} /> : null}
    <Dialog open={dialog} onClose={() => !busy && setDialog(false)} fullWidth maxWidth="sm">
      <DialogTitle>Add an existing user</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "12px !important" }}>
        <Typography variant="body2" color="text.secondary">Find an existing platform identity and grant a Site role (Admin, Editor, Publisher, Reviewer, or Viewer) for this Site only.</Typography>
        <Autocomplete options={identities} value={selected} onChange={(_, value) => { setSelected(value); setRoleId(""); }} inputValue={needle} onInputChange={(_, value) => setNeedle(value)} getOptionLabel={(option) => `${option.first_name} ${option.last_name} (${option.username})`.trim()} isOptionEqualToValue={(a, b) => a.id === b.id} noOptionsText={needle.length < 2 ? "Type at least two characters" : "No eligible users found"} renderInput={(props) => <TextField {...props} label="Search platform users" placeholder="Name, email or username" />} renderOption={(props, option) => <li {...props} key={option.id}><Box><Typography>{[option.first_name, option.last_name].filter(Boolean).join(" ") || option.username}</Typography><Typography variant="caption" color="text.secondary">{option.email} · {option.username}</Typography></Box></li>} />
        <TextField select label="Site role" value={roleId} onChange={(event) => setRoleId(Number(event.target.value))}>
          {roles.filter((role) => role.assignable && !selected?.assigned_role_ids.includes(role.id)).map((role) => <MenuItem key={role.id} value={role.id}>{role.name}</MenuItem>)}
        </TextField>
        {roles.every((role) => !role.assignable) ? <Alert severity="warning">There are no roles delegated to your account for this Site.</Alert> : null}
        {selected && roles.some((role) => role.assignable) && roles.filter((role) => role.assignable).every((role) => selected.assigned_role_ids.includes(role.id)) ? <Alert severity="info">This user already has every role you can assign for this Site.</Alert> : null}
      </DialogContent>
      <DialogActions sx={{ p: 2 }}><Button onClick={() => setDialog(false)} disabled={busy}>Cancel</Button><Button variant="contained" onClick={() => void add()} disabled={!selected || roleId === "" || roles.every((role) => !role.assignable) || busy}>{busy ? "Adding…" : "Add user"}</Button></DialogActions>
    </Dialog>
    <Dialog open={Boolean(confirming)} onClose={() => !busy && setConfirming(null)}>
      <DialogTitle>Remove Site role?</DialogTitle><DialogContent><Typography>This revokes {confirming?.role_name} for {confirming?.user_name} on {site.name}. Their identity and other Site access remain unchanged.</Typography></DialogContent>
      <DialogActions sx={{ p: 2 }}><Button onClick={() => setConfirming(null)} disabled={busy}>Cancel</Button><Button color="error" variant="contained" onClick={() => void remove()} disabled={busy}>{busy ? "Removing…" : "Remove role"}</Button></DialogActions>
    </Dialog>
  </Box>;
}
