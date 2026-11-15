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
import type {WorkspaceSite, WorkspaceState} from "@/workspace";

export function WorkspaceSwitcher({state, onNavigate}: {state: WorkspaceState; onNavigate?: () => void}) {
  const [open, setOpen] = useState(false);
  const data = state.status === "ready" ? state.data : null;
  const router = useRouter();
  const select = (href: string) => {
    window.dispatchEvent(new CustomEvent("uog:navigation:request", {detail: {target: `${APP_BASE_PATH}${href}`}}));
    setOpen(false); onNavigate?.(); router.push(href);
  };
  return <>
    <Button aria-label="Workspace" variant="outlined" fullWidth disabled={!data} onClick={() => setOpen(true)}>
      {data?.site?.name ?? "Choose workspace"}
    </Button>
    {open && data ? <Dialog open onClose={() => setOpen(false)} fullWidth maxWidth="sm" aria-labelledby="workspace-title">
      <DialogTitle id="workspace-title">Choose workspace</DialogTitle>
      <DialogContent>
        {hasPlatformWorkspace(data.platformPermissions) ? <Button onClick={() => select("/")}>Platform administration</Button> : null}
        <SiteChoices key={data.site?.id ?? "platform"} select={select}/>
      </DialogContent>
      <DialogActions><Button onClick={() => setOpen(false)}>Close</Button></DialogActions>
    </Dialog> : null}
  </>;
}

function SiteChoices({select}: {select: (href: string) => void}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const key = `${search}:${page}:${retry}`;
  const [response, setResponse] = useState<{key: string; rows: WorkspaceSite[]; count: number; error: boolean} | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => {
      const query = new URLSearchParams({search, page: String(page), page_size: "20"});
      void fetch(`${APP_BASE_PATH}/api/workspace/sites/?${query}`, {cache: "no-store", signal: controller.signal})
        .then(async result => {
          if (!result.ok) throw new Error("Discovery unavailable");
          const data = await result.json();
          if (!Array.isArray(data.results) || !Number.isInteger(data.count) || data.count < 0 || !data.results.every((row: WorkspaceSite) => Number.isSafeInteger(row.id) && typeof row.name === "string")) throw new Error("Invalid discovery");
          if (active) setResponse({key, rows: data.results, count: data.count, error: false});
        }).catch(() => {if (active) setResponse({key, rows: [], count: 0, error: true});});
    }, search ? 250 : 0);
    return () => {active = false; clearTimeout(timer); controller.abort();};
  }, [key, page, search]);
  const current = response?.key === key ? response : null;
  return <Box sx={{display: "flex", flexDirection: "column", gap: 1.5, pt: 1}}>
    <TextField autoFocus label="Search Sites" value={search} onChange={event => {setSearch(event.target.value); setPage(1);}} slotProps={{htmlInput: {maxLength: 100}}}/>
    {!current ? <p role="status">Loading Sites…</p> : current.error ? <Alert severity="error" action={<Button onClick={() => setRetry(value => value + 1)}>Retry</Button>}>Sites could not be loaded.</Alert> : <>
      {current.rows.length === 0 ? <p role="status">No Sites found. Try another search or ask for a Site membership.</p> : null}
      {current.rows.map(site => <Button key={site.id} data-workspace-site={site.id} sx={{justifyContent: "flex-start"}} onClick={() => select(`/sites/${site.id}/admin`)}>{site.name}</Button>)}
      <Box sx={{display: "flex", alignItems: "center", justifyContent: "space-between"}}>
        <Button disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous Sites</Button>
        <span aria-live="polite">Page {page} · {current.count} Sites</span>
        <Button disabled={page * 20 >= current.count} onClick={() => setPage(value => value + 1)}>Next Sites</Button>
      </Box>
    </>}
  </Box>;
}
