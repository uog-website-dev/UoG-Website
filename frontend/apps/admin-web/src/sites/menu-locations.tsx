"use client";
import {useState} from "react";
import {useAsync} from "@uog/ui";
import {ApiError} from "@uog/api-client";
import {Alert,Box,Button,Checkbox,FormControlLabel,TextField,Typography} from "@mui/material";
import {loadMenuLocations,saveMenuLocation,publishMenuLocation} from "@/app/sites/menu-actions";
import type {MenuRecord,MenuLocationRecord} from "@/app/sites/menu-actions";
import {unwrap} from "@/organizations/contract";

function locationError(error:unknown):string {
 if(error instanceof ApiError){
  if(error.status===409)return "This location changed or needs explicit replacement. Reload the locations and confirm your choice before retrying.";
  const details=error.details as {fields?:Record<string,unknown>}|null;
  if(details?.fields){const messages=Object.entries(details.fields).flatMap(([field,value])=>(Array.isArray(value)?value:[value]).filter((text):text is string=>typeof text==="string").map(text=>`${field}: ${text}`));if(messages.length)return messages.join(" ");}
 }
 return error instanceof Error?error.message:"The assignment could not be saved.";
}

function Slot({site,row,menus,enabled,canWrite,canPublish,onChanged}:{site:number;row:MenuLocationRecord;menus:MenuRecord[];enabled:boolean;canWrite:boolean;canPublish:boolean;onChanged:()=>void}) {
 const [selected,setSelected]=useState(row.draft_menu ?? ""),[replace,setReplace]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const replacement=Boolean(selected && (row.draft_menu??row.published_menu) && selected!==(row.draft_menu??row.published_menu));
 async function run(publish:boolean){setBusy(true);setError("");try{unwrap(await (publish?publishMenuLocation(site,row.location,row.version):saveMenuLocation(site,row.location,row.version,selected||null,replace)));onChanged();}catch(e){setError(locationError(e));}finally{setBusy(false);}}
 const name=(id:string|null)=>id?menus.find(m=>m.id===id)?.name ?? "Unavailable menu":"Unassigned";
 return <Box component="section" aria-label={row.label} sx={{border:1,borderColor:"divider",borderRadius:2,p:2,display:"grid",gap:1.5,minWidth:0}}>
  <Typography component="h3" variant="subtitle1">{row.label}</Typography>
  <Typography variant="body2">Public: {name(row.published_menu)}{row.is_published?"":" (legacy fallback)"}</Typography>
  <TextField select label={`${row.label} draft menu`} size="small" value={selected} onChange={event=>{setSelected(event.target.value);setReplace(false);}} disabled={!enabled||!canWrite||busy} slotProps={{select:{native:true},inputLabel:{shrink:true}}}>
   <option value="">Unassigned</option>{selected && !menus.some(m=>m.id===selected)?<option value={selected}>Unavailable menu</option>:null}
   {menus.map(m=><option key={m.id} value={m.id}>{m.name}{m.is_active?" (published)":" (draft/retired)"}</option>)}
  </TextField>
  {replacement?<FormControlLabel control={<Checkbox checked={replace} onChange={event=>setReplace(event.target.checked)} disabled={busy||!enabled||!canWrite}/>} label={`Replace current ${row.label} menu`}/>:null}
  <Box sx={{display:"flex",gap:1,flexWrap:"wrap"}}>
   {canWrite?<Button disabled={!enabled||busy||(replacement&&!replace)} onClick={()=>void run(false)}>Save {row.label} draft</Button>:null}
   {canPublish?<Button variant="outlined" disabled={!enabled||busy||!row.has_changes} onClick={()=>void run(true)}>Publish {row.label}</Button>:null}
  </Box>
  {row.has_changes?<Typography variant="caption">Assignment draft has not been published. Public navigation is unchanged.</Typography>:null}
  {error?<Alert severity="error">{error}</Alert>:null}
 </Box>;
}
export function MenuLocationPanel({site,menus,enabled,canWrite,canPublish}:{site:number;menus:MenuRecord[];enabled:boolean;canWrite:boolean;canPublish:boolean}){
 const state=useAsync(async()=>({site,rows:unwrap(await loadMenuLocations(site))}),[site]);
 const current=state.data?.site===site?state.data.rows:[];
 return <Box component="section" aria-label="Template menu locations" sx={{display:"grid",gap:2}}>
  <Typography component="h2" variant="h6">Template menu locations</Typography>
  <Typography variant="body2">Save an assignment draft, then publish it to change public navigation. Unassigning a location keeps the menu and its items.</Typography>
  <Button onClick={state.reload}>Refresh locations</Button>
  {state.loading?<Typography role="status">Loading menu locations...</Typography>:null}
  {state.error?<Alert severity="error">{state.error.message}</Alert>:null}
  {!state.loading && state.data?.site===site && current.length===0?<Typography>The active template declares no menu locations.</Typography>:null}
  <Box sx={{display:"grid",gridTemplateColumns:{xs:"minmax(0,1fr)",md:"repeat(2,minmax(0,1fr))"},gap:2}}>
   {current.map(row=><Slot key={`${site}:${row.location}:${row.version}`} site={site} row={row} menus={menus.filter(m=>m.site===site&&!m.is_global)} enabled={enabled&&!state.loading} canWrite={canWrite} canPublish={canPublish} onChanged={state.reload}/>)}
  </Box>
 </Box>;
}
