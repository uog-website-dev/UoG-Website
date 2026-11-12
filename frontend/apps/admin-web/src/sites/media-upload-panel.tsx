"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { Alert, Box, Button, Chip, IconButton, LinearProgress, Paper, Stack, TextField, Typography } from "@mui/material";
import UploadFileRoundedIcon from "@mui/icons-material/UploadFileRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import { updateSiteMedia } from "@/app/sites/media-actions";
import type { MediaAssetRecord, UploadPolicy } from "@/app/sites/media-actions";
import { unwrap } from "@/organizations/contract";
import { APP_BASE_PATH } from "@/base-path";

type Phase = "queued" | "uploading" | "metadata" | "complete" | "error";
interface UploadEntry {
  key: string; file: File; name: string; categories: string; alt: string;
  phase: Phase; error?: string; asset?: MediaAssetRecord;
}
export function mediaCategories(value: string): string[] {
  return [...new Map(value.split(",").map(v => v.trim()).filter(Boolean).map(v => [v.toLocaleLowerCase(), v])).values()];
}
export function mediaBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}
function requestKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, v => v.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function LocalPreview({file}: {file: File}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || typeof URL.createObjectURL !== "function") return;
    const value = URL.createObjectURL(file); setUrl(value); setFailed(false);
    return () => URL.revokeObjectURL(value);
  }, [file]);
  return <Box sx={{width:72,height:72,flexShrink:0,bgcolor:"grey.100",borderRadius:1.5,display:"grid",placeItems:"center",overflow:"hidden"}}>
    {url && !failed ? <Box component="img" src={url} alt={`Selected ${file.name}`} onError={() => setFailed(true)} sx={{width:"100%",height:"100%",objectFit:"cover"}} /> : <InsertDriveFileOutlinedIcon color="action" />}
  </Box>;
}

/** Separate retry identities and bounded parallel uploads, with recoverable metadata saves. */
export function MediaUploadPanel({siteId, policy, inputRef, onAccepted, onBusyChange}: {
  siteId: number; policy: UploadPolicy; inputRef: RefObject<HTMLInputElement | null>;
  onAccepted: (asset: MediaAssetRecord) => void; onBusyChange?: (busy: boolean) => void;
}) {
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true);
  const controllers = useRef(new Set<AbortController>());
  const running = useRef(false);
  const dragDepth = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; for (const controller of controllers.current) controller.abort(); }; }, []);
  const patch = (key: string, change: Partial<UploadEntry>) => {
    if (mounted.current) setEntries(current => current.map(item => item.key === key ? {...item,...change} : item));
  };
  const add = (files: File[]) => {
    if (running.current) return;
    setNotice(null);
    setEntries(current => {
      const incoming = files.filter(file => !current.some(item => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified));
      const accepted = incoming.slice(0, Math.max(0,20-current.length));
      return [...current,...accepted.map(file => ({key:requestKey(),file,name:file.name.replace(/\.[^.]+$/, "") || file.name,categories:"",alt:"",phase:"queued" as const}))];
    });
    if (files.length + entries.length > 20) setNotice("A queue holds up to 20 files. Upload or clear this queue before adding more.");
  };
  const validate = (entry: UploadEntry): string | null => {
    if (!entry.name.trim() || entry.name.length > 255) return "Enter a media name of 1 to 255 characters.";
    const categories = mediaCategories(entry.categories);
    if (categories.length > 10 || categories.some(v => v.length > 64)) return "Use up to 10 categories, each no longer than 64 characters.";
    if (entry.alt.length > 255) return "Alt text must be no longer than 255 characters for use in Pages.";
    if (entry.file.size === 0) return "Empty files cannot be uploaded.";
    const limit = entry.file.type === "application/pdf" ? policy.pdf_max_bytes : entry.file.type === "text/plain" ? policy.text_max_bytes : policy.image_max_bytes;
    if (entry.file.size > limit) return `This file exceeds its ${mediaBytes(limit)} limit.`;
    if (entry.file.type && !policy.mime_types.includes(entry.file.type)) return "Unsupported file type. Choose PNG, JPEG, WebP, PDF or plain text.";
    return null;
  };
  const transfer = async (entry: UploadEntry) => {
    const invalid = validate(entry);
    if (invalid) { patch(entry.key,{phase:"error",error:invalid}); return; }
    const controller = new AbortController(); controllers.current.add(controller);
    let asset = entry.asset;
    try {
      if (!asset) {
        patch(entry.key,{phase:"uploading",error:undefined});
        const response = await fetch(`${APP_BASE_PATH}/sites/${siteId}/media-upload?filename=${encodeURIComponent(entry.file.name)}`, {
          method:"POST",headers:{"Content-Type":"application/octet-stream","Idempotency-Key":entry.key},body:entry.file,signal:controller.signal,
        });
        const body = await response.json().catch(() => { throw new Error(response.status === 413 ? "This file exceeds the server upload limit." : "The upload service returned an unexpected response. Retry this file."); });
        if (!response.ok) {
          const details = body.error?.details;
          const explanation = details && typeof details === "object" ? Object.values(details).flat().filter(value => typeof value === "string").join(" ") : "";
          throw new Error(explanation || body.error?.message || body.detail || "Upload failed. Your file is still selected for retry.");
        }
        if (!mounted.current) return;
        if (body.site !== siteId || typeof body.id !== "string") throw new Error("Upload response could not be verified for this Site.");
        asset = body as MediaAssetRecord;
        patch(entry.key,{asset,phase:"metadata"}); onAccepted(asset);
      }
      if (!mounted.current) return;
      patch(entry.key,{phase:"metadata",error:undefined});
      const saved = unwrap(await updateSiteMedia(siteId,asset.id,{display_name:entry.name.trim(),categories:mediaCategories(entry.categories),alt_text:entry.alt}));
      if (!mounted.current) return;
      patch(entry.key,{asset:saved,phase:"complete"}); onAccepted(saved);
    } catch (cause) {
      if (mounted.current) patch(entry.key,{asset,phase:"error",error:asset ? "File uploaded, but metadata could not be saved. Retry to save metadata without uploading again." : cause instanceof Error ? cause.message : "Upload failed. Retry this file."});
    } finally { controllers.current.delete(controller); }
  };
  const upload = async (onlyKey?: string) => {
    if (running.current) return;
    const pending = entries.filter(item => item.phase !== "complete" && (!onlyKey || item.key === onlyKey));
    if (!pending.length) return;
    running.current = true; setBusy(true); onBusyChange?.(true);
    let index = 0;
    const worker = async () => { while (index < pending.length && mounted.current) { const entry = pending[index++]!; await transfer(entry); } };
    try { await Promise.all([worker(),worker()]); }
    finally {
      running.current = false;
      if (mounted.current) {
        // Completed entries leave automatically; failures retain their retry identity.
        setEntries(current => current.filter(item => item.phase !== "complete"));
        setNotice("Upload finished. Successfully added files are now in the library; any files needing attention remain below.");
        setBusy(false); onBusyChange?.(false);
      }
    }
  };
  const completed = entries.filter(item => item.phase === "complete").length;
  const pending = entries.length-completed;
  return <Box sx={{display:"grid",gap:2}}>
    <input ref={inputRef} type="file" multiple accept={policy.mime_types.join(",")} aria-label="Upload media file" style={{display:"none"}} disabled={busy} onChange={event => { add(Array.from(event.target.files ?? [])); event.target.value=""; }} />
    <Box role="button" tabIndex={0} aria-label="Drop files to upload or browse" aria-disabled={busy}
      onClick={() => { if (!busy) inputRef.current?.click(); }}
      onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!busy) inputRef.current?.click(); } }}
      onDragEnter={event => { event.preventDefault(); if (Array.from(event.dataTransfer.types).includes("Files")) { dragDepth.current++; setDragging(true); } }}
      onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect=busy?"none":"copy"; }}
      onDragLeave={event => { event.preventDefault(); if (--dragDepth.current<=0) { dragDepth.current=0; setDragging(false); } }}
      onDrop={event => { event.preventDefault(); dragDepth.current=0; setDragging(false); add(Array.from(event.dataTransfer.files)); }}
      sx={{border:"2px dashed",borderColor:dragging?"primary.main":"grey.300",borderRadius:2,bgcolor:dragging?"primary.50":"background.paper",minHeight:190,p:3,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:1,cursor:busy?"wait":"pointer",transition:"background-color 150ms,border-color 150ms","&:hover":{borderColor:"primary.main",bgcolor:"action.hover"},"&:focus-visible":{outline:"3px solid",outlineColor:"primary.main",outlineOffset:3}}}>
      <UploadFileRoundedIcon sx={{fontSize:42,color:dragging?"primary.main":"text.secondary",mb:0.5}} />
      <Typography><strong>Drop files to upload</strong> or <Box component="span" sx={{color:"primary.main"}}>click to browse</Box></Typography>
      <Typography variant="body2" color="text.secondary" align="center">Select one or multiple files. Add names, categories and alt text before uploading.</Typography>
      <Typography variant="caption" color="text.secondary" align="center">PNG, JPEG, WebP up to {mediaBytes(policy.image_max_bytes)} | PDF up to {mediaBytes(policy.pdf_max_bytes)} | Text up to {mediaBytes(policy.text_max_bytes)}</Typography>
    </Box>
    {notice ? <Alert severity="info">{notice}</Alert> : null}
    {entries.length ? <Paper variant="outlined" sx={{p:{xs:1.5,sm:2},borderRadius:2}}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1} sx={{mb:2}}>
        <Box><Typography variant="subtitle1" fontWeight={600}>Upload queue</Typography><Typography variant="body2" color="text.secondary" role="status">{completed} of {entries.length} files added</Typography></Box>
        <Stack direction="row" gap={1}>
          <Button variant="contained" disabled={busy || !pending} onClick={() => void upload()}>{busy?"Uploading...":`Upload ${pending} ${pending===1?"file":"files"}`}</Button>
        </Stack>
      </Stack>
      <Box component="ul" aria-label="Upload queue" sx={{m:0,p:0,listStyle:"none",display:"grid",gap:2}}>
        {entries.map((entry,index) => <Box component="li" key={entry.key} aria-label={`Upload ${entry.file.name}`} sx={{borderTop:index?1:0,borderColor:"divider",pt:index?2:0}}>
          <Stack direction="row" alignItems="center" gap={1.5}>
            <LocalPreview file={entry.file} />
            <Box sx={{minWidth:0,flex:1}}><Typography variant="body2" fontWeight={600} sx={{overflowWrap:"anywhere"}}>{entry.file.name}</Typography><Typography variant="caption" color="text.secondary">{mediaBytes(entry.file.size)}</Typography></Box>
            <Chip size="small" color={entry.phase==="error"?"error":entry.phase==="complete"?"success":"default"} label={entry.phase==="complete"?(entry.asset?.processing_state==="READY"?"Ready":"Added - processing"):entry.phase==="metadata"?"Saving metadata":entry.phase==="uploading"?"Uploading":entry.phase==="error"?"Needs attention":"Queued"} />
            <IconButton disabled={busy} aria-label={`Remove ${entry.file.name} from queue`} onClick={() => setEntries(current => current.filter(item => item.key !== entry.key))}><CloseRoundedIcon fontSize="small" /></IconButton>
          </Stack>
          <Box sx={{display:"grid",gridTemplateColumns:{xs:"1fr",md:"1fr 1fr"},gap:1.5,mt:1.5}}>
            <TextField size="small" label={`Media name for ${entry.file.name}`} value={entry.name} disabled={busy || entry.phase==="complete"} onChange={e=>patch(entry.key,{name:e.target.value})} inputProps={{maxLength:255}} />
            <TextField size="small" label={`Categories for ${entry.file.name}`} value={entry.categories} disabled={busy || entry.phase==="complete"} onChange={e=>patch(entry.key,{categories:e.target.value})} helperText="Separate categories with commas, e.g. Campus, Events" />
            <TextField size="small" label={`Alt text for ${entry.file.name}`} value={entry.alt} disabled={busy || entry.phase==="complete"} onChange={e=>patch(entry.key,{alt:e.target.value})} inputProps={{maxLength:255}} multiline minRows={2} sx={{gridColumn:"1 / -1"}} helperText="Describe the image for accessibility, up to 255 characters. Optional for documents." />
          </Box>
          {["uploading","metadata"].includes(entry.phase) ? <LinearProgress aria-label={`Uploading ${entry.file.name}`} sx={{mt:1.5}} /> : null}
          {entry.error ? <Alert severity="error" sx={{mt:1.5}} action={<Button disabled={busy} onClick={()=>void upload(entry.key)}>{entry.asset?"Retry metadata":"Retry upload"}</Button>}>{entry.error}</Alert> : null}
        </Box>)}
      </Box>
    </Paper> : null}
  </Box>;
}
