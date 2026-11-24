"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import AddIcon from "@mui/icons-material/Add";
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Paper, Select, Skeleton, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { APP_BASE_PATH } from "@/base-path";
import { SiteSection, useSiteAdmin } from "@/sites/site-admin-frame";
import { createSiteDocumentCategory, getSiteDocument, listSiteDocumentCategories, listSiteDocuments, manageSiteDocument, saveSiteDocument } from "@/app/sites/document-actions";
import type { SiteDocumentCategory, SiteDocumentList, SiteDocumentQuery, SiteDocumentRecord } from "@/app/sites/document-actions";
import type { MediaAssetRecord } from "@/app/sites/media-actions";
import { unwrap } from "@/organizations/contract";
import { LazyMediaPickerDialog as MediaPickerDialog } from "@/sites/lazy-media-picker";
import { MediaLibrary } from "@/sites/media-library";
import { useToast } from "@uog/ui";

const PostRichEditor = dynamic(() => import("@/sites/post-rich-editor").then((module) => module.PostRichEditor), { loading: () => <Skeleton variant="rounded" height={170} /> });
const EMPTY: SiteDocumentList = { count: 0, next: null, previous: null, results: [] };
const STATUSES = ["DRAFT", "IN_REVIEW", "APPROVED", "PUBLISHED", "UNPUBLISHED", "ARCHIVED"];
const labelStatus = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
const assetIdFromReference = (value: string) => value.match(/\/assets\/([0-9a-f-]{36})$/i)?.[1] ?? "";

export function SiteDocuments() {
  const { site, permissions, enabledModuleCodes } = useSiteAdmin();
  const [rows, setRows] = useState<SiteDocumentList>(EMPTY);
  const [categories, setCategories] = useState<SiteDocumentCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState<SiteDocumentQuery>({ page: 1, page_size: 20 });
  const [pending, setPending] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SiteDocumentRecord | null>(null);
  const [notice, setNotice] = useState("");
  const toast = useToast();
  const canView = permissions.includes("content.documents.view");
  const canCreate = permissions.includes("content.documents.create");
  const canUpdate = permissions.includes("content.documents.update");
  const canPublish = permissions.includes("content.documents.publish");
  const canDelete = permissions.includes("content.documents.delete");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    const result = await listSiteDocuments(site.id, query);
    if (result.ok) setRows(result.data); else setError(result.error.message);
    setLoading(false);
  }, [site.id, query]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { listSiteDocumentCategories(site.id).then((result) => result.ok && setCategories(result.data)); }, [site.id]);
  const categoryNames = useMemo(() => new Map(categories.map((row) => [row.id, row.name])), [categories]);
  const updateFilter = (key: keyof SiteDocumentQuery, value: string) => setQuery((old) => ({ ...old, page: 1, [key]: value || undefined }));
  async function manage(row: SiteDocumentRecord, action: "publish" | "unpublish" | "delete") {
    setPending(row.id); setError("");
    const result = await manageSiteDocument(site.id, row.id, action);
    setPending(null);
    if (!result.ok) { setError(result.error.message); setConfirmDelete(null); return; }
    setConfirmDelete(null); setNotice(action === "delete" ? "Document deleted." : `Document ${action}ed.`); await load();
    toast.success(action === "delete" ? "Document deleted." : `Document ${action}ed.`);
  }
  const columns = ["Title", "Category", "File Type", "Version", "Visibility", "Status", "Last Updated", "Actions"];
  return <SiteSection sectionKey="documents">
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, borderRadius: 3 }}>
      <Stack spacing={2.5}>
        <Box display="flex" justifyContent="space-between" alignItems="center" gap={2} flexWrap="wrap">
          <Box><Typography variant="h2" component="h1" sx={{ fontSize: "1.5rem", fontWeight: 700 }}>Documents</Typography><Typography color="text.secondary">Search and manage official files belonging to this Site.</Typography></Box>
          {canCreate && <Button component={Link} href={`/sites/${site.id}/admin/documents/new`} variant="contained" startIcon={<AddIcon />}>Add New Document</Button>}
        </Box>
        {notice && <Alert severity="success" onClose={() => setNotice("")}>{notice}</Alert>}
        {error && <Alert severity="error" action={<Button onClick={() => void load()}>Retry</Button>}>{error}</Alert>}
        <Box component="form" role="search" aria-label="Search Site documents" display="flex" flexWrap="wrap" gap={1.5} onSubmit={(event) => { event.preventDefault(); setQuery((old) => ({ ...old, search: searchDraft, page: 1 })); }}>
          <TextField size="small" label="Search by title" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} />
          <TextField select size="small" label="Category" value={query.category ?? ""} onChange={(event) => updateFilter("category", event.target.value)} sx={{ minWidth: 170 }}><MenuItem value="">All categories</MenuItem>{categories.map((row) => <MenuItem key={row.id} value={row.id}>{row.name}</MenuItem>)}</TextField>
          <TextField select size="small" label="Status" value={query.status ?? ""} onChange={(event) => updateFilter("status", event.target.value)} sx={{ minWidth: 150 }}><MenuItem value="">All statuses</MenuItem>{STATUSES.map((value) => <MenuItem key={value} value={value}>{labelStatus(value)}</MenuItem>)}</TextField>
          <TextField select size="small" label="File type" value={query.file_type ?? ""} onChange={(event) => updateFilter("file_type", event.target.value)} sx={{ minWidth: 130 }}><MenuItem value="">All types</MenuItem><MenuItem value="pdf">PDF</MenuItem><MenuItem value="text">Text</MenuItem></TextField>
          <TextField select size="small" label="Visibility" value={query.visibility ?? ""} onChange={(event) => updateFilter("visibility", event.target.value)} sx={{ minWidth: 140 }}><MenuItem value="">All visibility</MenuItem>{["PUBLIC", "UNLISTED", "HIDDEN"].map((value) => <MenuItem key={value} value={value}>{labelStatus(value)}</MenuItem>)}</TextField>
          <Button type="submit">Search</Button><Button onClick={() => { setSearchDraft(""); setQuery({ page: 1, page_size: 20 }); }}>Clear filters</Button>
        </Box>
        <Box sx={{ overflowX: "auto" }}><Table aria-label="Site documents"><TableHead><TableRow>{columns.map((column) => <TableCell key={column}>{column}</TableCell>)}</TableRow></TableHead><TableBody>
          {rows.results.map((row) => <TableRow key={row.id}>
            <TableCell><Typography fontWeight={600}>{row.title}</Typography><Typography variant="caption" color="text.secondary">/{row.slug}</Typography></TableCell>
            <TableCell>{row.categories.map((id) => categoryNames.get(id) ?? "Unavailable").join(", ") || "—"}</TableCell>
            <TableCell>{row.file_type === "application/pdf" ? "PDF" : row.file_type === "text/plain" ? "Text" : "—"}</TableCell>
            <TableCell>{row.version || "—"}</TableCell><TableCell>{labelStatus(row.visibility)}</TableCell>
            <TableCell><Chip size="small" label={labelStatus(row.status)} color={row.status === "PUBLISHED" ? "success" : "default"} /></TableCell>
            <TableCell>{new Date(row.updated_at).toLocaleDateString()}</TableCell>
            <TableCell><Stack direction="row" flexWrap="wrap" gap={0.5}>
              <Button size="small" component="a" target="_blank" rel="noreferrer" href={`${APP_BASE_PATH}/sites/${site.id}/documents/${row.id}/preview`} aria-label={`Preview ${row.title}`}>Preview</Button>
              {canUpdate && <Button size="small" component={Link} href={`/sites/${site.id}/admin/documents/${row.id}/edit`} aria-label={`Edit ${row.title}`}>Edit</Button>}
              {canPublish && row.status !== "PUBLISHED" && <Button size="small" disabled={pending === row.id} onClick={() => void manage(row, "publish")}>Publish</Button>}
              {canPublish && row.status === "PUBLISHED" && <Button size="small" disabled={pending === row.id} onClick={() => void manage(row, "unpublish")}>Unpublish</Button>}
              {canDelete && <Button size="small" color="error" disabled={pending === row.id} onClick={() => setConfirmDelete(row)}>Delete</Button>}
            </Stack></TableCell>
          </TableRow>)}
          {!loading && rows.results.length === 0 && <TableRow><TableCell colSpan={8}><Typography color="text.secondary">{canView ? "No documents match these filters." : "You do not have permission to view Site documents."}</Typography></TableCell></TableRow>}
          {loading && <TableRow><TableCell colSpan={8}><Typography role="status">Loading documents…</Typography></TableCell></TableRow>}
        </TableBody></Table></Box>
        <Stack direction="row" alignItems="center" justifyContent="space-between"><Typography variant="body2">{rows.count} documents · Page {query.page ?? 1}</Typography><Box display="flex" gap={1}><Button disabled={(query.page ?? 1) <= 1 || loading} onClick={() => setQuery((old) => ({ ...old, page: (old.page ?? 1) - 1 }))}>Previous</Button><Button disabled={!rows.next || loading} onClick={() => setQuery((old) => ({ ...old, page: (old.page ?? 1) + 1 }))}>Next</Button></Box></Stack>
        {!enabledModuleCodes.includes("DOCUMENTS") && <Alert severity="warning">Documents is disabled for this Site. Enable the module to manage documents.</Alert>}
      </Stack>
    </Paper>
    <Dialog open={Boolean(confirmDelete)} onClose={() => !pending && setConfirmDelete(null)}><DialogTitle>Delete document?</DialogTitle><DialogContent><Typography>This removes “{confirmDelete?.title}”. Existing publication and audit history remains governed by the CMS retention policy.</Typography>{error && <Alert severity="error">{error}</Alert>}</DialogContent><DialogActions><Button disabled={Boolean(pending)} onClick={() => setConfirmDelete(null)}>Cancel</Button><Button color="error" disabled={Boolean(pending)} onClick={() => confirmDelete && void manage(confirmDelete, "delete")}>Delete document</Button></DialogActions></Dialog>
  </SiteSection>;
}

export function SiteDocumentEditor() {
  const { site, permissions, enabledModuleCodes } = useSiteAdmin();
  const params = useParams<{ documentId?: string }>();
  const router = useRouter();
  const id = params.documentId;
  const editing = Boolean(id);
  const canEdit = permissions.includes(editing ? "content.documents.update" : "content.documents.create");
  const canMediaView = permissions.includes("content.media.view") && enabledModuleCodes.includes("MEDIA");
  const canMediaUpload = permissions.includes("content.media.upload") && enabledModuleCodes.includes("MEDIA");
  const [title, setTitle] = useState(""); const [slug, setSlug] = useState(""); const [description, setDescription] = useState("");
  const [file, setFile] = useState(""); const [categories, setCategories] = useState<SiteDocumentCategory[]>([]); const [selectedCategories, setSelectedCategories] = useState<string[]>([]); const [newCategory, setNewCategory] = useState("");
  const [version, setVersion] = useState(""); const [effective, setEffective] = useState(""); const [visibility, setVisibility] = useState("PUBLIC");
  const [picker, setPicker] = useState(false); const [loading, setLoading] = useState(editing); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  useEffect(() => { listSiteDocumentCategories(site.id).then((result) => result.ok && setCategories(result.data)); }, [site.id]);
  useEffect(() => { if (!id) return; getSiteDocument(site.id, id).then((result) => { if (result.ok) { if (result.data.site !== site.id) { setError("This document does not belong to the selected Site."); return; } setTitle(result.data.title); setSlug(result.data.slug); setDescription(result.data.description); setFile(result.data.file_reference); setSelectedCategories(result.data.categories); setVersion(result.data.version); setEffective(result.data.effective_date ?? ""); setVisibility(result.data.visibility); } else setError(result.error.message); }).finally(() => setLoading(false)); }, [site.id, id]);
  async function save() { if (saving || !canEdit) return; setSaving(true); setError(""); try { unwrap(await saveSiteDocument(site.id, { title, slug, description, file_reference: file, categories: selectedCategories, version, effective_date: effective || null, visibility }, id)); router.push(`/sites/${site.id}/admin/documents`); } catch (cause) { setError(cause instanceof Error ? cause.message : "The document could not be saved."); } finally { setSaving(false); } }
  function selectFile(asset: MediaAssetRecord) { setFile(`sites/${site.id}/assets/${asset.id}`); setPicker(false); }
  return <SiteSection sectionKey="documents"><Paper variant="outlined" sx={{p:{xs:2,sm:3},borderRadius:3,maxWidth:1000,mx:"auto"}}>
    <Stack spacing={2.5} component="form" onSubmit={(event)=>{event.preventDefault();void save()}}>
      <Typography variant="h1" sx={{fontSize:"1.6rem",fontWeight:700}}>{editing ? "Edit Document" : "Add New Document"}</Typography>
      {!enabledModuleCodes.includes("DOCUMENTS") && <Alert severity="warning">Documents is disabled for this Site.</Alert>}
      {error && <Alert severity="error" role="alert">{error}</Alert>}
      {loading ? <Typography role="status">Loading document…</Typography> : <>
        <Paper component="section" variant="outlined" sx={{p:2}}><Stack spacing={2}><Typography variant="h2" sx={{fontSize:"1.1rem",fontWeight:700}}>Document Title</Typography><TextField required label="Document Title" value={title} onChange={(event)=>{setTitle(event.target.value);if(!editing)setSlug(event.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,""));}} inputProps={{maxLength:255}}/><TextField required label="Slug" value={slug} onChange={(event)=>setSlug(event.target.value)} helperText="Lowercase URL-safe identifier."/></Stack></Paper>
        <Paper component="section" variant="outlined" sx={{p:2}}><Stack spacing={1.5}><Typography variant="h2" sx={{fontSize:"1.1rem",fontWeight:700}}>File Upload</Typography><Typography>{file ? `Selected file: ${file.split("/").at(-1)}` : "Choose or upload a PDF or text file from this Site’s media library."}</Typography><Button variant="outlined" disabled={!canMediaView} onClick={()=>setPicker(true)}>{file ? "Change document file" : "Choose or upload a file"}</Button></Stack></Paper>
        <Paper component="section" variant="outlined" sx={{p:2}}><Stack spacing={1.5}><Typography variant="h2" sx={{fontSize:"1.1rem",fontWeight:700}}>Description</Typography><PostRichEditor value={description} onChange={setDescription} onSave={()=>void save()} siteId={site.id} canUseMedia={false} canUploadMedia={false} disabled={!canEdit}/></Stack></Paper>
        <Paper component="section" variant="outlined" sx={{p:2}}><Stack spacing={1.5}><Typography variant="h2" sx={{fontSize:"1.1rem",fontWeight:700}}>Categories</Typography><FormControl><InputLabel id="document-category-label">Categories</InputLabel><Select multiple labelId="document-category-label" label="Categories" value={selectedCategories} onChange={(event)=>setSelectedCategories(typeof event.target.value === "string" ? event.target.value.split(",") : event.target.value)}>{categories.map((category)=><MenuItem key={category.id} value={category.id}>{category.name}</MenuItem>)}</Select></FormControl><Box display="flex" gap={1}><TextField label="New category" size="small" value={newCategory} onChange={(event)=>setNewCategory(event.target.value)} disabled={!canEdit}/><Button disabled={!canEdit||!newCategory.trim()} onClick={async()=>{const created=unwrap(await createSiteDocumentCategory(site.id,newCategory.trim()));setCategories((old)=>[...old,created]);setSelectedCategories((old)=>[...old,created.id]);setNewCategory("")}}>Add category</Button></Box></Stack></Paper>
        <Paper component="section" variant="outlined" sx={{p:2}}><Stack spacing={1.5}><Typography variant="h2" sx={{fontSize:"1.1rem",fontWeight:700}}>Publish Settings</Typography><TextField select label="Visibility" value={visibility} onChange={(event)=>setVisibility(event.target.value)}>{["PUBLIC","UNLISTED","HIDDEN"].map((item)=><MenuItem key={item} value={item}>{labelStatus(item)}</MenuItem>)}</TextField><Typography color="text.secondary">Documents are initially saved as Draft. Authorized publishers can publish or unpublish them from the list.</Typography></Stack></Paper>
        <Paper component="section" variant="outlined" sx={{p:2}}><Stack spacing={1.5}><Typography variant="h2" sx={{fontSize:"1.1rem",fontWeight:700}}>Document Meta</Typography><TextField label="Version" value={version} onChange={(event)=>setVersion(event.target.value)} inputProps={{maxLength:40}}/><TextField type="date" label="Effective Date" value={effective} onChange={(event)=>setEffective(event.target.value)} slotProps={{inputLabel:{shrink:true}}}/></Stack></Paper>
        <Stack direction="row" gap={1}><Button type="submit" variant="contained" disabled={!canEdit || saving || !file}>{saving ? "Saving…" : "Save Draft"}</Button><Button component={Link} href={`/sites/${site.id}/admin/documents`}>Cancel</Button></Stack>
      </>}
    </Stack>
  </Paper><Dialog open={picker} onClose={()=>setPicker(false)} fullWidth maxWidth="lg"><DialogTitle>Choose a document file</DialogTitle><DialogContent><MediaLibrary siteId={site.id} canUpload={canMediaUpload} onSelect={selectFile} documentsOnly /></DialogContent><DialogActions><Button onClick={()=>setPicker(false)}>Close</Button></DialogActions></Dialog></SiteSection>;
}
