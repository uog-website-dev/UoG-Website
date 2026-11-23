"use client";
import {APP_BASE_PATH} from "@/base-path";
import {useState} from "react";
import {useSiteQuery,useInvalidateSite} from "@/data/query-cache";
import {ApiError} from "@uog/api-client";
import {Alert,Box,Button,Checkbox,FormControlLabel,TextField,Typography} from "@mui/material";
import {loadMenuLocations,saveMenuLocation,publishMenuLocation,saveFooterMenus} from "@/app/sites/menu-actions";
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

function Slot({site,row,menus,enabled,canWrite,canPublish,onChanged,serverError}:{site:number;row:MenuLocationRecord;menus:MenuRecord[];enabled:boolean;canWrite:boolean;canPublish:boolean;onChanged:(updated:MenuLocationRecord,error?:string)=>void;serverError?:string}) {
 const [selected,setSelected]=useState(row.draft_menu ?? ""),[replace,setReplace]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const footer=row.location==="footer";
 const initialColumns=row.draft_menus?.length?row.draft_menus:row.draft_menu?[row.draft_menu]:[];
 const [columns,setColumns]=useState<string[]>(initialColumns);
 const unsavedColumns=footer&&JSON.stringify(columns)!==JSON.stringify(initialColumns);
 const columnSelection=columns.filter(Boolean);
 const replacement=Boolean(selected && (row.draft_menu??row.published_menu) && selected!==(row.draft_menu??row.published_menu));
 async function run(publish:boolean){
  setBusy(true);setError("");
  let saved:MenuLocationRecord|undefined;
  try{
   let confirmed=row;
   if(footer&&publish){
    if(!row.version||JSON.stringify(columnSelection)!==JSON.stringify(row.draft_menus??[])){
     confirmed=unwrap(await saveFooterMenus(site,row.version,columnSelection,replace));
     // Preserve a successful save even if publication subsequently fails.
     saved=confirmed;
    }
    confirmed=unwrap(await publishMenuLocation(site,row.location,confirmed.version));
   }else{
    confirmed=unwrap(await (publish?publishMenuLocation(site,row.location,row.version):(footer?saveFooterMenus(site,row.version,columnSelection,replace):saveMenuLocation(site,row.location,row.version,selected||null,replace))));
   }
   onChanged(confirmed);
  }catch(e){const message=locationError(e);if(saved)onChanged(saved,message);else setError(message);}finally{setBusy(false);}
 }

 const name=(id:string|null)=>id?menus.find(m=>m.id===id)?.name ?? "Unavailable menu":"Unassigned";
 return <Box component="section" aria-label={row.label} sx={{border:1,borderColor:"divider",borderRadius:2,p:2,display:"grid",gap:1.5,minWidth:0}}>
  <Typography component="h3" variant="subtitle1">{row.label}</Typography>
  <Typography variant="body2">Public: {footer&&row.published_menus?.length?row.published_menus.map(id=>name(id)).join(", "):name(row.published_menu)}{row.is_published?"":" (legacy fallback)"}</Typography>
  {footer?<Box sx={{display:"grid",gap:1.5}}>
   <Typography variant="body2" color="text.secondary">Add up to four menus. Each menu becomes an equal-width column using its name as the heading. Columns stack on mobile.</Typography>
   {columns.map((id,index)=><Box key={index} sx={{display:"flex",gap:1,alignItems:"center",flexWrap:"wrap"}}>
    <TextField select label={`Footer column ${index+1} menu`} size="small" value={id} onChange={event=>{const next=[...columns];next[index]=event.target.value;setColumns(next);setSelected(next[0]??"");setReplace(false);}} disabled={!enabled||!canWrite||busy} sx={{flex:"1 1 220px"}} slotProps={{select:{native:true},inputLabel:{shrink:true}}}>
     <option value="">Choose a menu</option>{id&&!menus.some(m=>m.id===id)?<option value={id}>Unavailable menu</option>:null}
     {menus.map(m=><option key={m.id} value={m.id} disabled={columns.includes(m.id)&&m.id!==id}>{m.name}{m.is_active?" (published)":" (draft/retired)"}</option>)}
    </TextField>
    {canWrite?<><Button aria-label={`Move footer column ${index+1} left`} disabled={!enabled||busy||index===0} onClick={()=>{const next=[...columns];[next[index-1],next[index]]=[next[index],next[index-1]];setColumns(next);setSelected(next[0]??"");setReplace(false);}}>Move left</Button><Button aria-label={`Remove footer column ${index+1}`} disabled={!enabled||busy} onClick={()=>{const next=columns.filter((_,i)=>i!==index);setColumns(next);setSelected(next[0]??"");setReplace(false);}}>Remove</Button></>:null}
   </Box>)}
   {canWrite?<Button variant="outlined" sx={{justifySelf:"start"}} disabled={!enabled||busy||columns.length>=4} onClick={()=>setColumns([...columns,""])}>Add footer column</Button>:null}
  </Box>:<>

  <TextField select label={`${row.label} draft menu`} size="small" value={selected} onChange={event=>{setSelected(event.target.value);setReplace(false);}} disabled={!enabled||!canWrite||busy} slotProps={{select:{native:true},inputLabel:{shrink:true}}}>
   <option value="">Unassigned</option>{selected && !menus.some(m=>m.id===selected)?<option value={selected}>Unavailable menu</option>:null}
   {menus.map(m=><option key={m.id} value={m.id}>{m.name}{m.is_active?" (published)":" (draft/retired)"}</option>)}
  </TextField>
  </>}
  {replacement?<FormControlLabel control={<Checkbox checked={replace} onChange={event=>setReplace(event.target.checked)} disabled={busy||!enabled||!canWrite}/>} label={`Replace current ${row.label} menu`}/>:null}
  <Box sx={{display:"flex",gap:1,flexWrap:"wrap"}}>
   {canWrite?<Button disabled={!enabled||busy||(replacement&&!replace)||(footer&&columns.some(id=>!id))} onClick={()=>void run(false)}>Save {row.label} draft</Button>:null}
   {canPublish?<Button variant="outlined" disabled={!enabled||busy||(footer?(columns.some(id=>!id)||(replacement&&!replace)||(unsavedColumns&&!canWrite)):!row.has_changes)} onClick={()=>void run(true)}>Publish {row.label}</Button>:null}
  </Box>
  {unsavedColumns?<Typography variant="caption">Publish Footer will save these column changes and publish them.</Typography>:null}
  {footer&&!row.has_changes&&!unsavedColumns&&row.is_published?<Typography variant="caption">Footer is published. You can publish again to confirm the current assignment.</Typography>:null}
  {row.has_changes?<Typography variant="caption">Assignment draft has not been published. Public navigation is unchanged.</Typography>:null}
  {error||serverError?<Alert severity="error">{error||serverError}</Alert>:null}
 </Box>;
}
export function MenuLocationPanel({site,menus,enabled,canWrite,canPublish}:{site:number;menus:MenuRecord[];enabled:boolean;canWrite:boolean;canPublish:boolean}){
 const invalidateSite=useInvalidateSite();
 const [slotErrors,setSlotErrors]=useState<Record<string,string>>({});
 const state=useSiteQuery(site,"menu-locations",{},async()=>({site,rows:unwrap(await loadMenuLocations(site))}),{enabled});
 const current=state.data?.site===site?state.data.rows:[];
 return <Box data-perf-pending={state.loading?"true":"false"} component="section" aria-label="Template menu locations" sx={{display:"grid",gap:2}}>
  <Typography component="h2" variant="h6">Template menu locations</Typography>
  <Typography variant="body2">Save an assignment draft, then publish it to change public navigation. Unassigning a location keeps the menu and its items.</Typography>
  {canWrite?<Button component="a" href={enabled?`${APP_BASE_PATH}/sites/${site}/admin/menus/preview`:undefined} target="_blank" rel="noopener noreferrer" disabled={!enabled}>Preview draft navigation</Button>:null}
  <Button onClick={state.reload}>Refresh locations</Button>
  {state.refreshing?<Typography role="status">Refreshing menu locations?</Typography>:null}
  {state.loading?<Typography role="status">Loading menu locations...</Typography>:null}
  {state.error?<Alert severity="error">{state.error.message}</Alert>:null}
  {!state.loading && state.data?.site===site && current.length===0?<Typography>The active template declares no menu locations.</Typography>:null}
  <Box sx={{display:"grid",gridTemplateColumns:{xs:"minmax(0,1fr)",md:"repeat(2,minmax(0,1fr))"},gap:2}}>
   {current.map(row=><Slot key={`${site}:${row.location}:${row.version}`} site={site} row={row} menus={menus.filter(m=>m.site===site&&!m.is_global)} enabled={enabled&&!state.loading} canWrite={canWrite} canPublish={canPublish} serverError={slotErrors[`${site}:${row.location}`]} onChanged={(updated,error)=>{setSlotErrors(previous=>({...previous,[`${site}:${updated.location}`]:error??""}));state.setData(previous=>({site,rows:(previous?.site===site?previous.rows:[]).map(item=>item.location===updated.location?updated:item)}));invalidateSite(site,"menus");}}/>)}
  </Box>
 </Box>;
}
