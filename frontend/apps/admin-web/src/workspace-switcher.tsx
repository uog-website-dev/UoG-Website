"use client";
import {useEffect, useState} from "react";
import {useRouter} from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import {APP_BASE_PATH} from "@/base-path";
import {hasPlatformWorkspace} from "@/navigation";
import {useQuery} from "@tanstack/react-query";
import {queryKey, useQueryEnvironment} from "@/data/query-cache";
import {useWorkspaceNavigation, type WorkspaceSite, type WorkspaceState} from "@/workspace";
import {confirmSiteSwitch} from "@/sites/site-draft-guard";

export function WorkspaceSwitcher({state, onNavigate}: {state: WorkspaceState; onNavigate?: () => void}) {
  const [open, setOpen] = useState(false);
  const data = state.status === "ready" ? state.data : null;
  const navigation = useWorkspaceNavigation();
  const router = useRouter();
  const select = (href: string) => {
    if (!confirmSiteSwitch()) return;
    navigation?.cancel();
    window.dispatchEvent(new CustomEvent("uog:navigation:request", {detail: {target: `${APP_BASE_PATH}${href}`}}));
    setOpen(false); onNavigate?.(); router.push(href);
  };
  return <>
    <Button aria-label="Workspace" variant="outlined" fullWidth disabled={!data && !navigation?.pending && state.status !== "error"} onClick={() => setOpen(true)} aria-busy={!!navigation?.pending}>
      {navigation?.pending?.site.name ?? data?.site?.name ?? "Choose workspace"}
    </Button>
    {open ? <Dialog open onClose={() => setOpen(false)} fullWidth maxWidth="sm" aria-labelledby="workspace-title">
      <DialogTitle id="workspace-title">Choose workspace</DialogTitle>
      <DialogContent>
        {data && hasPlatformWorkspace(data.platformPermissions) ? <Button onClick={() => select("/")}>Platform administration</Button> : null}
        <SiteChoices select={site => {
          if (navigation) {if (navigation.select(site)) {setOpen(false); onNavigate?.();}}
          else select(`/sites/${site.id}/admin`);
        }}/>
      </DialogContent>
      <DialogActions><Button onClick={() => setOpen(false)}>Close</Button></DialogActions>
    </Dialog> : null}
  </>;
}

function SiteChoices({select}: {select: (site: WorkspaceSite) => void}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const environment = useQueryEnvironment();
  const [appliedSearch, setAppliedSearch] = useState("");
  useEffect(() => {const timer = setTimeout(() => setAppliedSearch(search), search ? 250 : 0); return () => clearTimeout(timer);}, [search]);
  const result = useQuery<{results: WorkspaceSite[]; count: number}>({
    queryKey: queryKey(environment, "site-switcher", {search, page, page_size: 20}), enabled: search === appliedSearch,
    queryFn: async ({signal}) => {
      const query = new URLSearchParams({search, page: String(page), page_size: "20"});
      const response = await fetch(`${APP_BASE_PATH}/api/workspace/sites/?${query}`, {cache: "no-store", signal});
      if (!response.ok) throw new Error("Sites unavailable");
      const data = await response.json();
      if (!Array.isArray(data.results) || !Number.isInteger(data.count) || data.count < 0 || !data.results.every((row: WorkspaceSite) => Number.isSafeInteger(row.id) && typeof row.name === "string")) throw new Error("Invalid discovery");
      return data;
    },
  });
  const current = result.isError ? {error: true, rows: [], count: 0} : result.data ? {error: false, rows: result.data.results, count: result.data.count} : null;
  return <Box sx={{display: "flex", flexDirection: "column", gap: 1.5, pt: 1}}>
    <TextField autoFocus label="Search Sites" value={search} onChange={event => {setSearch(event.target.value); setPage(1);}} slotProps={{htmlInput: {maxLength: 100}}}/>
    {!current ? <p role="status">Loading Sites…</p> : current.error ? <Alert severity="error" action={<Button onClick={() => void result.refetch()}>Retry</Button>}>Sites could not be loaded.</Alert> : <>
      {current.rows.length === 0 ? <p role="status">No Sites found. Try another search or ask for a Site membership.</p> : null}
      {current.rows.map(site => <Button key={site.id} data-workspace-site={site.id} sx={{justifyContent: "flex-start"}} onClick={() => select(site)}>{site.name}</Button>)}
      <Box sx={{display: "flex", alignItems: "center", justifyContent: "space-between"}}>
        <Button disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous Sites</Button>
        <span aria-live="polite">Page {page} · {current.count} Sites</span>
        <Button disabled={page * 20 >= current.count} onClick={() => setPage(value => value + 1)}>Next Sites</Button>
      </Box>
    </>}
  </Box>;
}
