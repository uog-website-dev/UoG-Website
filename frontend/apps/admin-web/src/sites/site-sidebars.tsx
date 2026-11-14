"use client";

import { sidebarWidgetRegistry } from "@uog/types";
import { PublicPageView } from "@uog/ui";
import { loadSitePages } from "@/app/sites/page-actions";
import { ApiError } from "@uog/api-client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { listSiteSidebars, sidebarMenuOptions, saveSiteSidebar, deleteSiteSidebar } from "@/app/sites/sidebar-actions";
import type { SidebarRecord, SidebarMenuOption, SidebarComponent } from "@/app/sites/sidebar-actions";
import { unwrap } from "@/organizations/contract";

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError && cause.details && typeof cause.details === "object") {
    const fields = Object.entries(cause.details).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(" ") : typeof value === "string" ? value : JSON.stringify(value)}`);
    if (fields.length) return fields.join(" ");
  }
  return cause instanceof Error ? cause.message : fallback;
}

export function SiteSidebars({ siteId, permissions, menusEnabled, postsEnabled = false }: { siteId: number; permissions: readonly string[]; menusEnabled: boolean; postsEnabled?: boolean }) {
  const [rows, setRows] = useState<SidebarRecord[]>([]);
  const [menus, setMenus] = useState<SidebarMenuOption[]>([]);
  const [current, setCurrent] = useState<SidebarRecord | null>(null);
  const [name, setName] = useState("");
  const [components, setComponents] = useState<SidebarComponent[]>([]);
  const [menu, setMenu] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [kind, setKind] = useState<"menu" | "related_pages" | "recent_posts">("menu");
  const [title, setTitle] = useState("Related Pages");
  const [limit, setLimit] = useState(5);
  const [pageIds, setPageIds] = useState<string[]>([]);
  const [pages, setPages] = useState<{id:string;title:string;status:string}[]>([]);
  useEffect(() => {
    let cancelled = false;
    setPages([]); setPageIds([]); setKind("menu"); setEditingIndex(null);
    loadSitePages(siteId, { page_size: 100, ordering: "title" }).then(result => {
      if (!cancelled) setPages(unwrap(result).results.filter(row => row.site === siteId && !row.draft_of));
    }).catch(() => { if (!cancelled) setPages([]); });
    return () => { cancelled = true; };
  }, [siteId]);
  const [status, setStatus] = useState<"ACTIVE" | "ARCHIVED">("ACTIVE");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  const canEdit = permissions.includes("content.pages.update");
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(""); setRows([]); setMenus([]);
    setCurrent(null); setName(""); setComponents([]); setMenu(""); setStatus("ACTIVE");
    Promise.all([listSiteSidebars(siteId), menusEnabled ? sidebarMenuOptions(siteId) : Promise.resolve({ ok: true as const, data: [] })])
      .then(([sidebars, options]) => { if (!cancelled) { setRows(unwrap(sidebars).filter(row => row.site === siteId)); setMenus(unwrap(options)); } })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Sidebars could not be loaded."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [siteId, reload, menusEnabled]);
  function edit(row: SidebarRecord | null) {
    setEditingIndex(null); setCurrent(row); setName(row?.name ?? ""); setComponents(row?.components ?? []); setStatus(row?.status ?? "ACTIVE"); setError(""); setMessage("");
  }
  async function save() {
    if (!canEdit || busy) return;
    if (!name.trim() || !components.length) { setError("Enter a sidebar name and add at least one sidebar component."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const row = unwrap(await saveSiteSidebar(siteId, { name: name.trim(), components, status }, current ?? undefined));
      setRows(previous => [...previous.filter(item => item.id !== row.id), row].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)));
      setCurrent(row); setMessage("Sidebar saved. Existing published Pages keep their reviewed sidebar until their next publication.");
    } catch (cause) { setError(errorMessage(cause, "Save failed. Your changes are still here.")); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!current || !canEdit || busy || !window.confirm(`Delete sidebar “${current.name}”? Assigned sidebars cannot be deleted.`)) return;
    setBusy(true); setError("");
    try { unwrap(await deleteSiteSidebar(siteId, current)); setRows(previous => previous.filter(row => row.id !== current.id)); edit(null); setMessage("Unused sidebar deleted."); }
    catch (cause) { setError(errorMessage(cause, "Deletion was rejected.")); }
    finally { setBusy(false); }
  }
  function configure(index: number) {
    const component = components[index];
    setEditingIndex(index); setKind(component.type);
    if (component.type === "menu") setMenu(component.menu_id);
    else { setTitle(component.title); if (component.type === "related_pages") setPageIds(component.page_ids); else setLimit(component.limit); }
  }
  function put(component: SidebarComponent) {
    setComponents(previous => editingIndex === null ? [...previous, component] : previous.map((value, index) => index === editingIndex ? { ...component, id: value.id } : value));
    setEditingIndex(null); setMenu("");
  }
  function move(index: number, step: number) {
    setComponents(previous => { const result = [...previous]; [result[index], result[index + step]] = [result[index + step], result[index]]; return result; });
  }
  return <Box sx={{ display: "grid", gap: 3 }}>
    <Box><Typography component="h1" variant="h4">Reusable sidebars</Typography><Typography color="text.secondary">Arrange approved Menu, related Page and recent Post components, then reuse this sidebar on Pages.</Typography></Box>
    {!menusEnabled ? <Alert severity="info">Enable MENUS to add eligible navigation components. Existing published Pages retain their content; navigation delivery follows the MENUS gate.</Alert> : null}
    {loading ? <Typography role="status">Loading sidebars…</Typography> : null}
    {error ? <Alert severity="error" role="alert" action={<Button onClick={() => setReload(value => value + 1)} disabled={busy}>Reload</Button>}>{error}</Alert> : null}
    {message ? <Alert severity="success" role="status">{message}</Alert> : null}
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0,1fr)", md: "280px minmax(0,1fr)" }, gap: 3 }}>
      <Paper variant="outlined" sx={{ p: 2, alignSelf: "start", display: "grid", gap: 1 }}>
        <Typography component="h2" variant="h6">Site sidebars</Typography>
        {canEdit ? <Button onClick={() => edit(null)} disabled={busy}>New sidebar</Button> : null}
        {!loading && !rows.length ? <Typography>No sidebars yet. Create one using an existing Site Menu.</Typography> : null}
        {rows.map(row => <Button key={row.id} aria-pressed={current?.id === row.id} onClick={() => edit(row)} disabled={busy} sx={{ justifyContent: "flex-start", overflowWrap: "anywhere" }}>{row.name}{row.status === "ARCHIVED" ? " (archived)" : ""}</Button>)}
      </Paper>
      <Paper component="form" onSubmit={event => { event.preventDefault(); void save(); }} variant="outlined" sx={{ p: { xs: 2, sm: 3 }, display: "grid", gap: 2 }} aria-label="Sidebar editor">
        <Typography component="h2" variant="h6">{current ? "Edit sidebar" : "Create sidebar"}</Typography>
        <TextField required label="Sidebar name" value={name} inputProps={{ maxLength: 120 }} onChange={event => setName(event.target.value)} disabled={!canEdit || busy || loading} />
        <TextField select label="Sidebar status" value={status} onChange={event => setStatus(event.target.value as typeof status)} disabled={!canEdit || busy || loading} helperText="Assigned sidebars cannot be archived or deleted."><MenuItem value="ACTIVE">Active</MenuItem><MenuItem value="ARCHIVED">Archived</MenuItem></TextField>
        <Typography component="h3" variant="subtitle1">Ordered components</Typography>
        <Box component="ol" sx={{ m: 0, pl: 3 }}>
          {components.map((component, index) => <Box component="li" key={component.id} sx={{ mb: 1 }}>
            <Typography>{component.type === 'menu' ? menus.find(item => item.id === component.menu_id)?.name ?? 'Unavailable Menu' : component.title}</Typography>
            <Button aria-label={`Move component ${index + 1} up`} disabled={!canEdit || busy || index === 0} onClick={() => move(index, -1)}>Up</Button>
            <Button aria-label={`Move component ${index + 1} down`} disabled={!canEdit || busy || index === components.length - 1} onClick={() => move(index, 1)}>Down</Button>
            <Button aria-label={`Configure component ${index + 1}`} disabled={!canEdit || busy} onClick={() => configure(index)}>Configure</Button>
            <Button color="error" aria-label={`Remove component ${index + 1}`} disabled={!canEdit || busy} onClick={() => { setComponents(previous => previous.filter(item => item.id !== component.id)); setEditingIndex(null); }}>Remove</Button>
          </Box>)}
        </Box>
        <TextField select label="Component type" value={kind} disabled={!canEdit || busy} onChange={event => { const next = event.target.value as typeof kind; setKind(next); setTitle(next === "recent_posts" ? "Recent Posts" : "Related Pages"); }}>
          {sidebarWidgetRegistry.map(item => <MenuItem key={item.type} value={item.type}>{item.label}</MenuItem>)}
        </TextField>
        {kind !== "menu" ? <>
          <TextField label="Component title" required value={title} inputProps={{ maxLength: 120 }} onChange={event => setTitle(event.target.value)} disabled={!canEdit || busy} />
          {kind === "related_pages" ? <TextField select SelectProps={{ multiple: true }} label="Related Pages" value={pageIds} onChange={event => { const value = event.target.value; setPageIds(typeof value === "string" ? value.split(",") : value); }} disabled={!canEdit || busy} helperText="Up to 20 Site Pages; only eligible published Pages render. Selection order is preserved.">{pages.map(page => <MenuItem key={page.id} value={page.id}>{page.title} ({page.status})</MenuItem>)}</TextField> : <TextField type="number" label="Post count" value={limit} inputProps={{ min: 1, max: 10 }} onChange={event => setLimit(Number(event.target.value))} disabled={!canEdit || busy} helperText={postsEnabled ? "Latest published Site Posts, maximum 10." : "POSTS is disabled. Enable it before adding this component."} />}
          <Button disabled={!canEdit || busy || !title.trim() || (editingIndex === null && components.length >= 12) || (kind === "recent_posts" && (!postsEnabled || !Number.isInteger(limit) || limit < 1 || limit > 10)) || pageIds.length > 20} onClick={() => put(kind === "related_pages" ? { id: `pages-${crypto.randomUUID()}`, type: "related_pages", title: title.trim(), page_ids: pageIds } : { id: `posts-${crypto.randomUUID()}`, type: "recent_posts", title: title.trim(), limit })}>{editingIndex === null ? "Add content component" : "Update content component"}</Button>
        </> : <>
        <TextField select label="Menu component" value={menu} onChange={event => setMenu(event.target.value)} disabled={!canEdit || busy || !menusEnabled || loading} helperText="Only active local Menus from this Site are eligible.">
          <MenuItem value="">Choose a Menu</MenuItem>{menus.filter(item => !components.some((component, index) => index !== editingIndex && component.type === "menu" && component.menu_id === item.id)).map(item => <MenuItem key={item.id} value={item.id}>{item.name} ({item.location})</MenuItem>)}
        </TextField>
        <Button disabled={!menu || !canEdit || busy || components.length >= 12} onClick={() => put({ id: `menu-${crypto.randomUUID()}`, type: "menu", menu_id: menu })}>{editingIndex === null ? "Add Menu component" : "Update Menu component"}</Button>
        </>}
        <Button component={Link} href={`/sites/${siteId}/admin/menus`}>Manage Site Menus</Button>
        {current?.snapshot ? <Box aria-label="Saved sidebar preview"><Typography variant="h6" component="h3">Saved sidebar preview</Typography><PublicPageView page={{ title: "Sidebar preview", site: siteId, path: "/", layout: "RIGHT_SIDEBAR", sidebar_id: current.id, sidebar_snapshot: current.snapshot, blocks: [], seo: {title:"", description:""} }} privateMediaBase="/admin/media" /></Box> : null}
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}><Button type="submit" variant="contained" disabled={!canEdit || busy || loading || components.some(component => component.type === "menu" ? !menusEnabled : component.type === "recent_posts" && !postsEnabled)}>{busy ? "Saving…" : "Save sidebar"}</Button>{current && canEdit ? <Button color="error" onClick={() => void remove()} disabled={busy}>Delete unused sidebar</Button> : null}</Box>
      </Paper>
    </Box>
  </Box>;
}
