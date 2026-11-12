"use client";
import { useEffect, useRef, useState } from "react";
import { Alert, Box, Button, Chip, Typography, TextField, MenuItem, Dialog, DialogTitle, DialogContent, DialogActions, Paper, ToggleButton, ToggleButtonGroup, Skeleton, IconButton } from "@mui/material";
import { ApiError } from "@uog/api-client";
import { useAsync } from "@uog/ui";
import { listSiteMedia, getMediaUploadPolicy, getSiteMedia, updateSiteMedia, getMediaReferences, removeSiteMedia } from "@/app/sites/media-actions";
import type { MediaAssetRecord } from "@/app/sites/media-actions";
import { unwrap } from "@/organizations/contract";
import type { MediaListQuery, MediaReferenceInventory, MediaStatus } from "@uog/types";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import OpenInFullRoundedIcon from "@mui/icons-material/OpenInFullRounded";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import { MediaUploadPanel, mediaBytes, mediaCategories } from "@/sites/media-upload-panel";
import { APP_BASE_PATH } from "@/base-path";

const IN_USE_MESSAGE = "This asset is in use by a draft, publication or nested placement and cannot be deleted. The library card and metadata are unchanged.";

function referenceLabel(ref: MediaReferenceInventory["references"][number]): string {
  const slot = [ref.node_id, ref.field_path, ref.repeater_item_id].filter(Boolean).join(" / ");
  return `${ref.scope}${slot ? `: ${slot}` : ""}`;
}

const previewKey = (asset: MediaAssetRecord) => `${asset.id}:${asset.thumbnail_status}:${asset.updated_at}`;

/** Shared library and ready-only picker. Selection always passes an asset ID. */
interface MediaLibraryProps {
  siteId: number; canUpload: boolean; canDelete?: boolean; onSelect?: (asset: MediaAssetRecord) => void; imagesOnly?: boolean;
}

/** A Site change unmounts all query, dialog, upload and filter state synchronously. */
export function MediaLibrary(props: MediaLibraryProps) {
  return <SiteMediaLibrary key={props.siteId} {...props} />;
}

function SiteMediaLibrary({ siteId, canUpload, canDelete = false, onSelect, imagesOnly = false }: MediaLibraryProps) {
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [page, setPage] = useState(1);
  const [failedPreviews, setFailedPreviews] = useState<Set<string>>(new Set());
  const [previewVersion, setPreviewVersion] = useState(0);
  const [filters, setFilters] = useState<MediaListQuery>({});
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<MediaStatus | "">("");
  const [type, setType] = useState<"image" | "document" | "">("");
  const [confirmDeletion, setConfirmDeletion] = useState(false);
  const [removalNotice, setRemovalNotice] = useState<string | null>(null);
  const [viewerAsset, setViewerAsset] = useState<MediaAssetRecord | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [altText, setAltText] = useState("");
  const [mediaName, setMediaName] = useState("");
  const [categoryText, setCategoryText] = useState("");
  const altTextDirty = useRef(false);
  const [saving, setSaving] = useState(false);
  const [metadataNotice, setMetadataNotice] = useState<string | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const detail = useAsync(async () => detailId ? unwrap(await getSiteMedia(siteId, detailId)) : null, [siteId, detailId]);
  const inventory = useAsync(async () => detailId && canDelete ? unwrap(await getMediaReferences(siteId, detailId)) : null, [siteId, detailId, canDelete]);
  const currentDetail = detail.data?.id === detailId && detail.data.site === siteId ? detail.data : null;
  useEffect(() => {
    if (currentDetail && !altTextDirty.current) {
      setAltText(currentDetail.alt_text);
      setMediaName(currentDetail.display_name || currentDetail.original_filename);
      setCategoryText((currentDetail.categories ?? []).join(", "));
    }
  }, [currentDetail]);

  const uploadInput = useRef<HTMLInputElement | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const rows = useAsync(async () => unwrap(await listSiteMedia(siteId, {
    ...filters, page,
    ...(onSelect ? imagesOnly ? { ready_images: true } : { status: "READY" as const } : imagesOnly ? { type: "image" as const } : {}),
  })), [siteId, Boolean(onSelect), imagesOnly, page, filters]);
  const policy = useAsync(async () => canUpload ? unwrap(await getMediaUploadPolicy(siteId)) : null, [siteId, canUpload]);
  const [pollError, setPollError] = useState(false);
  const [watchUntil, setWatchUntil] = useState(() => onSelect ? Date.now() + 120000 : 0);
  const scope = useRef(0);
  // Invalidate pending background results synchronously when the query changes.
  const queryIdentity = `${siteId}:${page}:${JSON.stringify(filters)}:${Boolean(onSelect)}:${imagesOnly}`;
  const currentQuery = useRef(queryIdentity);
  if (currentQuery.current !== queryIdentity) { currentQuery.current = queryIdentity; scope.current += 1; }
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const detailRef = useRef({ id: detailId, saving, altText, currentDetail });
  detailRef.current = { id: detailId, saving, altText, currentDetail };
  const hasProcessing = rows.data?.results.some((asset) => asset.status === "PENDING" || asset.processing_state === "PROCESSING") ?? false;
  useEffect(() => {
    if (rows.status !== "success" || (!hasProcessing && Date.now() >= watchUntil)) return;
    let cancelled = false;
    let timer: number;
    let failures = 0;
    const requestScope = scope.current;
    const poll = async () => {
      try {
        const result = unwrap(await listSiteMedia(siteId, {
          ...filters, page,
          ...(onSelect ? imagesOnly ? { ready_images: true } : { status: "READY" as const } : imagesOnly ? { type: "image" as const } : {}),
        }));
        if (cancelled || requestScope !== scope.current) return;
        failures = 0; setPollError(false);
        rowsRef.current.setData(result);
        const active = detailRef.current;
        const updated = result.results.find((asset) => asset.id === active.id);
        // Refresh processing metadata without replacing an unsaved alt-text edit.
        if (updated && !active.saving) detail.setData(updated);
        if (!result.results.some((asset) => asset.status === "PENDING" || asset.processing_state === "PROCESSING") && Date.now() >= watchUntil) return;
      } catch {
        if (cancelled || requestScope !== scope.current) return;
        setPollError(true);
        if (++failures >= 3) return;
      }
      timer = window.setTimeout(() => void poll(), failures ? 10000 : 5000);
    };
    timer = window.setTimeout(() => void poll(), 5000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [queryIdentity, rows.status, hasProcessing, watchUntil]);
  useEffect(() => () => { scope.current += 1; }, []);
  const saveMetadata = async () => {
    if (!currentDetail || saving || !canUpload) return;
    setSaving(true); setMetadataError(null); setMetadataNotice(null);
    try {
      const changes: { display_name?: string; categories?: string[]; alt_text?: string } = {};
      if (mediaName !== (currentDetail.display_name || currentDetail.original_filename)) changes.display_name = mediaName.trim();
      if (JSON.stringify(mediaCategories(categoryText)) !== JSON.stringify(currentDetail.categories ?? [])) changes.categories = mediaCategories(categoryText);
      if (altText !== currentDetail.alt_text) changes.alt_text = altText;
      const saved = unwrap(await updateSiteMedia(siteId, currentDetail.id, changes));
      altTextDirty.current = false; detail.setData(saved); rows.reload(); setMetadataNotice("Changes saved.");
    } catch (cause) {
      // Preserve the editor's alt text draft after a recoverable save failure.
      setMetadataError(cause instanceof Error ? cause.message : "Metadata could not be saved.");
    }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!currentDetail || saving || !canDelete) return;
    setSaving(true); setMetadataError(null);
    try {
      unwrap(await removeSiteMedia(siteId,currentDetail.id));
      setConfirmDeletion(false); setDetailId(null); rows.reload();
      setRemovalNotice("Asset removed. Storage cleanup runs in the background.");
    } catch (cause) {
      setConfirmDeletion(false);
      const conflict = cause instanceof ApiError && cause.status === 409;
      setMetadataError(conflict ? IN_USE_MESSAGE : cause instanceof Error ? cause.message : "Asset could not be removed. Check your connection and try again.");
      inventory.reload();
      rows.reload();
    }
    finally { setSaving(false); }
  };
  const activeReferences = inventory.data?.asset_id === detailId ? inventory.data.references : [];
  const inUse = activeReferences.length > 0;
  const visible = (rows.data?.results ?? []).filter((asset) => asset.site === siteId && (!onSelect || (asset.status === "READY" && asset.processing_state === "READY" && !["PROCESSING", "FAILED", "UNAVAILABLE"].includes(asset.thumbnail_status))) && (!imagesOnly || asset.detected_mime.startsWith("image/")));
  const metadataChanged = currentDetail && (altText !== currentDetail.alt_text || mediaName !== (currentDetail.display_name || currentDetail.original_filename) || JSON.stringify(mediaCategories(categoryText)) !== JSON.stringify(currentDetail.categories ?? []));
  return <Box component="section" aria-label="Site media library" sx={{ display: "grid", gap: 2.5, minWidth: 0, bgcolor: "grey.50", p: { xs: 1.5, sm: 2.5 }, borderRadius: 2 }}>
    <Box sx={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:2,flexWrap:"wrap"}}>
      <Box><Typography variant="h5" component="h2" fontWeight={600}>{onSelect ? "Choose media" : "Media Library"}</Typography><Typography variant="body2" color="text.secondary" sx={{mt:0.5}}>Your Site's images and documents, in one place.</Typography></Box>
      {canUpload && policy.data ? <Button variant="contained" disabled={uploadBusy} startIcon={<CloudUploadOutlinedIcon />} onClick={() => uploadInput.current?.click()}>Upload files</Button> : null}
    </Box>
    {canUpload && policy.data ? <MediaUploadPanel siteId={siteId} policy={policy.data} inputRef={uploadInput} onBusyChange={setUploadBusy} onAccepted={() => { setWatchUntil(Date.now()+120000); setPage(1); rows.reload(); }} /> : null}
    <Box component="form" role="search" aria-label="Search Site media" onSubmit={(event) => {
      event.preventDefault(); setFilters({ search, ...(status ? { status } : {}), ...(type ? { type } : {}) }); setPage(1);
    }} sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", bgcolor:"background.paper", p:2, borderRadius:2, boxShadow:1, alignItems:"center" }}>
      <TextField size="small" label="Search media" value={search} onChange={(event) => setSearch(event.target.value)} inputProps={{ maxLength: 255 }} sx={{flex:"1 1 220px"}} />
      {!onSelect ? <TextField size="small" select label="Media status" value={status} onChange={(event) => setStatus(event.target.value as MediaStatus | "")} sx={{ minWidth: 160 }}>
        <MenuItem value="">All statuses</MenuItem>
        {(["PENDING", "READY", "REJECTED", "ARCHIVED"] as const).map((value) => <MenuItem key={value} value={value}>{value === "PENDING" ? "Processing" : value.charAt(0) + value.slice(1).toLowerCase()}</MenuItem>)}
      </TextField> : null}
      {!imagesOnly ? <TextField size="small" select label="Media type" value={type} onChange={(event) => setType(event.target.value as typeof type)} sx={{ minWidth: 160 }}>
        <MenuItem value="">All types</MenuItem><MenuItem value="image">Images</MenuItem><MenuItem value="document">Documents</MenuItem>
      </TextField> : null}
      <Button type="submit">Search media</Button>
      <Button onClick={() => { setFilters({}); setSearch(""); setStatus(""); setType(""); setPage(1); }}>Clear filters</Button>
    </Box>

    {removalNotice ? <Alert severity="success">{removalNotice}</Alert> : null}
    {pollError ? <Alert severity="warning">Automatic updates are paused or delayed. Use Refresh media to check again.</Alert> : null}
    {policy.error ? <Alert severity="error">Upload policy unavailable. Refresh the page to try again.</Alert> : null}
    {rows.error ? <Alert severity="error" action={<Button onClick={() => rows.reload()}>Retry media</Button>}>Media could not be loaded. {rows.error.message}</Alert> : null}
    <Box sx={{ display: "flex", gap: 2, justifyContent: "space-between", flexWrap: "wrap", alignItems: "center" }}>
      <Typography role="status" aria-live="polite">{rows.loading || rows.status === "idle" ? "Loading media…" : rows.error ? "Media unavailable" : `${rows.data?.count ?? 0} assets · Page ${page}`}</Typography>
      <Box sx={{display:"flex",gap:1,alignItems:"center"}}><Button size="small" onClick={() => { rows.reload(); setFailedPreviews(new Set()); setPreviewVersion((value) => value + 1); }}>Refresh media</Button>
      <ToggleButtonGroup exclusive value={layout} onChange={(_, value) => { if (value) setLayout(value); }} aria-label="Media layout" size="small">
        <ToggleButton value="grid" aria-label="Grid view">Grid</ToggleButton><ToggleButton value="list" aria-label="List view">List</ToggleButton>
      </ToggleButtonGroup></Box>
    </Box>
    {rows.loading && !rows.data ? <Box aria-hidden="true" sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(3, minmax(0, 1fr))" }, gap: 2 }}>{[1, 2, 3].map((key) => <Skeleton key={key} variant="rounded" height={200} />)}</Box> : null}
    {rows.data && rows.loading ? <Typography role="status">Updating results...</Typography> : null}
    <Box component="ul" aria-label="Site media assets" aria-busy={rows.loading} sx={{ m: 0, p: 0, listStyle: "none", display: "grid", gap: 2, gridTemplateColumns: layout === "grid" ? "repeat(auto-fill, minmax(min(100%, 200px), 1fr))" : "minmax(0, 1fr)" }}>
      {visible.map((asset) => <Paper component="li" variant="outlined" key={asset.id} sx={{ display: "flex", flexDirection: layout === "grid" ? "column" : "row", alignItems:layout === "list" ? "center" : "stretch", p:layout === "list" ? 1.5 : 0, gap:layout === "list" ? 1.5 : 0, minWidth:0, overflow:"hidden", borderRadius:2, boxShadow:"0 1px 3px rgba(15,23,42,0.08)", transition:"box-shadow 150ms", "&:hover":{boxShadow:3} }}>
        <Box sx={{position:"relative",width:layout === "grid"?"100%":{xs:80,sm:104},flexShrink:0,bgcolor:"grey.100",borderRadius:layout === "list"?1.5:0,overflow:"hidden"}}>
          <Box component="button" type="button" aria-label={`Preview ${asset.display_name || asset.original_filename}`} onClick={() => { if (asset.detected_mime.startsWith("image/") && asset.status === "READY" && asset.processing_state === "READY") setViewerAsset(asset); else { altTextDirty.current=false; setDetailId(asset.id); setMetadataError(null); setMetadataNotice(null); } }} sx={{display:"block",width:"100%",p:0,border:0,bgcolor:"transparent",cursor:"pointer","&:focus-visible":{outline:"3px solid",outlineColor:"primary.main",outlineOffset:-3}}}>
            <MediaPreview asset={asset} siteId={siteId} version={previewVersion} compact={layout === "list"} onFailure={() => setFailedPreviews(previous => new Set(previous).add(previewKey(asset)))} />
          </Box>
          {layout === "grid" ? <Chip label={asset.detected_mime.startsWith("image/")?"IMAGE":"DOCUMENT"} size="small" sx={{position:"absolute",top:10,right:10,bgcolor:"rgba(15,23,42,0.72)",color:"white",borderRadius:1,fontSize:11,height:22,pointerEvents:"none"}} /> : null}
        </Box>
        <Box sx={{p:layout === "grid"?1.5:0,minWidth:0,display:"flex",flexDirection:"column",gap:0.75,flex:1}}>
          <Typography variant="body2" fontWeight={600} sx={{overflowWrap:"anywhere",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{asset.display_name || asset.original_filename}</Typography>
          <Typography variant="caption" color="text.secondary">{mediaBytes(asset.byte_count)}{asset.width && asset.height ? ` | ${asset.width} x ${asset.height}` : ` | ${asset.content_type ?? asset.detected_mime}`}</Typography>
          <Box sx={{display:"flex",flexWrap:"wrap",gap:0.5}}>{asset.processing_state !== "READY" ? <Chip label={asset.processing_state} size="small" color={asset.processing_state==="FAILED"?"error":"default"} variant="outlined" sx={{height:21,fontSize:10}} /> : null}{(asset.categories ?? []).slice(0,3).map(category=><Chip key={category} label={category} size="small" sx={{height:21,fontSize:10}} />)}</Box>
          {asset.processing_state === "FAILED" ? <Typography role="status" variant="caption" color="error">Processing failed: {asset.processing_error_code || "Validation failed"}.</Typography> : null}
          <Typography variant="caption" color="text.secondary" sx={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>Alt text: {asset.alt_text || "Not set"}</Typography>
          <Box sx={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:1,mt:"auto"}}>
            <Button size="small" aria-label={`Details for ${asset.original_filename}`} onClick={() => { altTextDirty.current=false; setDetailId(asset.id); setMetadataError(null); setMetadataNotice(null); }}>Edit details</Button>
            {onSelect ? <Button variant="contained" size="small" disabled={failedPreviews.has(previewKey(asset))} onClick={() => onSelect(asset)}>Select {asset.original_filename}</Button> : null}
          </Box>
        </Box>
      </Paper>)}
    </Box>
    {rows.status === "success" && visible.length === 0 ? <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
      <Typography>No {onSelect ? "ready " : ""}media found.</Typography>
      <Typography color="text.secondary">{Object.keys(filters).length ? "Try another filename or clear the filters." : canUpload ? "Upload a file to start this Site's library. Images appear in pickers when processing finishes." : "This Site has no matching media. Ask a Site Editor to upload a file or refresh the library."}</Typography>
      {Object.keys(filters).length ? <Button onClick={() => { setFilters({}); setSearch(""); setStatus(""); setType(""); setPage(1); }}>Show all media</Button> : <Button onClick={() => rows.reload()}>Check for media</Button>}
    </Paper> : null}
    <Dialog open={detailId !== null} onClose={() => { if (!saving) setDetailId(null); }} fullWidth maxWidth="lg" aria-labelledby="media-detail-title" PaperProps={{sx:{borderRadius:3,overflow:"hidden"}}}>
      <DialogTitle id="media-detail-title" sx={{borderBottom:1,borderColor:"divider",pr:7,fontWeight:600}}>Media details<IconButton aria-label="Close media details" disabled={saving} onClick={()=>setDetailId(null)} sx={{position:"absolute",right:12,top:12}}><CloseRoundedIcon /></IconButton></DialogTitle>
      <DialogContent sx={{p:0}}>
        {currentDetail ? <Box sx={{display:"grid",gridTemplateColumns:{xs:"1fr",md:"minmax(0,1.35fr) minmax(320px,1fr)"}}}>
          <Box sx={{bgcolor:"grey.100",p:{xs:2,md:3},display:"flex",flexDirection:"column",justifyContent:"center",gap:2,minWidth:0}}>
            <MediaPreview key={`${currentDetail.id}:${previewVersion}`} asset={currentDetail} siteId={siteId} version={previewVersion} large />
            {currentDetail.detected_mime.startsWith("image/") && currentDetail.status === "READY" && currentDetail.processing_state === "READY" ? <Button startIcon={<OpenInFullRoundedIcon />} onClick={()=>setViewerAsset(currentDetail)}>Expand image</Button> : null}
            <Typography variant="caption" color="text.secondary" align="center" sx={{overflowWrap:"anywhere"}}>{currentDetail.original_filename}</Typography>
          </Box>
          <Box sx={{display:"grid",gap:2,p:{xs:2,md:3},minWidth:0}}>
          <Box sx={{display:"flex",justifyContent:"space-between",gap:1,alignItems:"center"}}><Typography variant="h6" sx={{overflowWrap:"anywhere"}}>{currentDetail.display_name || currentDetail.original_filename}</Typography><Chip size="small" label={currentDetail.processing_state} color={currentDetail.processing_state === "READY" ? "success" : currentDetail.processing_state === "FAILED" ? "error" : "default"} /></Box>
          <Typography sx={{ overflowWrap: "anywhere" }}>{currentDetail.original_filename}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{overflowWrap:"anywhere"}}>Asset ID: {currentDetail.id}</Typography>
          <Typography variant="body2" color="text.secondary">{mediaBytes(currentDetail.byte_count)} | {currentDetail.content_type}{currentDetail.width && currentDetail.height ? ` | ${currentDetail.width} x ${currentDetail.height} px` : ""}</Typography>
          <Typography>Thumbnail: {currentDetail.thumbnail_status.replaceAll("_", " ").toLowerCase()}</Typography>
          {canDelete ? <Typography>References: {inventory.data?.asset_id === detailId ? activeReferences.length : "Loading…"}. Drafts, live publications and nested Image/Slider/Gallery placements protect this asset.</Typography> : null}
          {canDelete && inUse ? <Alert severity="warning" role="status">
            This asset is in use and cannot be deleted.
            <Box component="ul" sx={{ m: 0, pl: 2 }}>
              {activeReferences.map((ref) => <Typography component="li" key={ref.id} variant="body2">{referenceLabel(ref)}</Typography>)}
            </Box>
          </Alert> : null}
          <TextField label="Media name" value={mediaName} onChange={(event) => { altTextDirty.current=true; setMediaName(event.target.value); setMetadataNotice(null); }} disabled={!canUpload || saving} inputProps={{maxLength:255}} helperText="The name shown in your library. The original file stays unchanged." />
          <TextField label="Categories" value={categoryText} onChange={(event) => { altTextDirty.current=true; setCategoryText(event.target.value); setMetadataNotice(null); }} disabled={!canUpload || saving} helperText="Separate categories with commas. Up to 10 labels." />
          <TextField label="Alt text" value={altText} onChange={(event) => { altTextDirty.current = true; setAltText(event.target.value); setMetadataNotice(null); }} disabled={!canUpload || saving} multiline minRows={2} inputProps={{ maxLength: 1000, "aria-label": "Alt text" }} helperText="Describe the asset for accessibility. Plain text, up to 1000 characters." />
        </Box></Box> : <Typography sx={{p:3}}>{detail.loading ? "Loading media details…" : "Media details unavailable."}</Typography>}
        {metadataNotice ? <Alert severity="success">{metadataNotice}</Alert> : null}
        {metadataError || detail.error ? <Alert severity="error" role="alert">{metadataError ?? detail.error?.message}</Alert> : null}
        {canDelete && inventory.error ? <Alert severity="error" action={<Button onClick={() => inventory.reload()}>Retry references</Button>}>Reference inventory unavailable. This is a temporary transport problem, not a delete conflict. Deletion stays disabled until references can be verified.</Alert> : null}
      </DialogContent>
      <DialogActions sx={{p:2,borderTop:1,borderColor:"divider",gap:1,flexWrap:"wrap"}}>
        <Button disabled={saving} onClick={() => setDetailId(null)}>Close details</Button>
        {canDelete && currentDetail ? <Button color="error" disabled={saving || inventory.loading || Boolean(inventory.error) || inventory.data?.asset_id !== detailId || inUse} onClick={() => { setMetadataError(null); setConfirmDeletion(true); }}>Delete unused asset</Button> : null}
        {canUpload && currentDetail ? <Button variant="contained" disabled={saving || !metadataChanged || !mediaName.trim()} onClick={() => void saveMetadata()}>{saving ? "Saving…" : "Save changes"}</Button> : null}
      </DialogActions>
    </Dialog>
    <Dialog fullScreen open={viewerAsset !== null} onClose={()=>setViewerAsset(null)} aria-labelledby="media-viewer-title" PaperProps={{sx:{bgcolor:"#101318",color:"white"}}}>
      <Box sx={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:2,px:{xs:2,sm:3},py:1.5,borderBottom:"1px solid rgba(255,255,255,0.12)"}}>
        <Box sx={{minWidth:0}}><Typography id="media-viewer-title" component="h2" fontWeight={600} noWrap>{viewerAsset?.display_name || viewerAsset?.original_filename}</Typography><Typography variant="caption" sx={{color:"grey.400"}}>{viewerAsset ? mediaBytes(viewerAsset.byte_count) : ""}{viewerAsset?.width && viewerAsset.height ? ` | ${viewerAsset.width} x ${viewerAsset.height} px` : ""}</Typography></Box>
        <IconButton aria-label="Close image preview" onClick={()=>setViewerAsset(null)} sx={{color:"white",bgcolor:"rgba(255,255,255,0.08)"}}><CloseRoundedIcon /></IconButton>
      </Box>
      {viewerAsset ? <Box sx={{flex:1,minHeight:0,display:"flex",alignItems:"center",justifyContent:"center",p:{xs:1,sm:4},overflow:"auto"}}><MediaPreview key={`${viewerAsset.id}:${previewVersion}:viewer`} asset={viewerAsset} siteId={siteId} version={previewVersion} large immersive /></Box> : null}
      <Box sx={{textAlign:"center",px:3,py:2,borderTop:"1px solid rgba(255,255,255,0.12)"}}><Typography variant="body2" sx={{overflowWrap:"anywhere",color:"grey.300"}}>{viewerAsset?.alt_text || "No alt text added."}</Typography><Button sx={{mt:1,color:"white"}} onClick={()=>{ if(viewerAsset){if(detailId !== viewerAsset.id){altTextDirty.current=false;setDetailId(viewerAsset.id);setMetadataError(null);setMetadataNotice(null);}setViewerAsset(null);} }}>Edit media details</Button></Box>
    </Dialog>
    <Dialog open={confirmDeletion} onClose={() => { if (!saving) setConfirmDeletion(false); }} aria-labelledby="media-remove-title">
      <DialogTitle id="media-remove-title">Delete this unused asset?</DialogTitle>
      <DialogContent><Typography>The asset will disappear immediately and its stored files will be removed. Any new reference will block deletion.</Typography>
        {metadataError ? <Alert severity="error">{metadataError}</Alert> : null}
      </DialogContent>
      <DialogActions><Button disabled={saving} onClick={() => setConfirmDeletion(false)}>Cancel deletion</Button><Button color="error" disabled={saving} onClick={() => void remove()}>Confirm deletion</Button></DialogActions>
    </Dialog>
    <Box component="nav" aria-label="Media pagination" sx={{ display: "flex", gap: 1 }}><Button disabled={page === 1 || rows.loading || Boolean(rows.error)} onClick={() => setPage(page - 1)}>Previous</Button><Button disabled={!rows.data?.next || rows.loading || Boolean(rows.error)} onClick={() => setPage(page + 1)}>Next</Button></Box>
  </Box>;
}


function MediaPreview({ asset, siteId, version, large = false, immersive = false, compact = false, onFailure }: {
  asset: MediaAssetRecord; siteId: number; version: number; large?: boolean; immersive?: boolean; compact?: boolean; onFailure?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [asset.id, asset.thumbnail_status, version]);
  if (!asset.detected_mime.startsWith("image/")) return <Box sx={{height:compact?88:large?180:185,display:"grid",placeItems:"center",color:"primary.light",bgcolor:"primary.50"}}><InsertDriveFileOutlinedIcon sx={{fontSize:64}} /></Box>;
  if (asset.status === "PENDING" || asset.processing_state === "PROCESSING") return <Box role="status" sx={{ p: 2, bgcolor: "action.hover", borderRadius: 1 }}>Image preview will appear when processing finishes.</Box>;
  if (asset.status !== "READY" || asset.processing_state !== "READY") return <Typography color="text.secondary">Image preview unavailable.</Typography>;
  if (failed) return <Typography role="status">Preview unavailable. Refresh to retry.</Typography>;
  return <Box component="img" alt={asset.alt_text || asset.original_filename} loading="lazy"
    src={`${APP_BASE_PATH}/sites/${siteId}/media/${asset.id}/image?variant=${large ? "display" : "thumbnail"}`}
    onError={() => { setFailed(true); onFailure?.(); }}
    sx={{ display: "block", objectFit: large || compact ? "contain" : "cover", width: "100%", maxWidth: "100%", height: immersive ? "auto" : large ? {xs:280,md:440} : compact ? 88 : 185, maxHeight: immersive ? "calc(100dvh - 200px)" : undefined, bgcolor: immersive ? "transparent" : "action.hover", borderRadius: immersive ? 0 : 2 }} />;
}
