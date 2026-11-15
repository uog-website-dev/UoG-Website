"use client";
import {useEffect,useRef,useState} from "react";
import {Alert,Box,Button,Chip,CircularProgress,Paper,Typography} from "@mui/material";
import {VisualLayoutView} from "@uog/ui";
import type {VisualLayout} from "@uog/types";
import {loadHomepageTemplates,prepareHomepageTemplate} from "@/app/sites/homepage-template-actions";
import type {HomepageTemplate} from "@/app/sites/homepage-template-actions";

export function HomepageTemplateCatalogue({siteId,canEdit,onChoose}:{siteId:number;canEdit:boolean;onChoose?:(layout:VisualLayout,name:string)=>void}){
 if(!canEdit)return <Alert severity="info">Page editing permission is required to browse homepage templates.</Alert>;
 return <Catalogue key={siteId} siteId={siteId} onChoose={onChoose}/>;
}
function Catalogue({siteId,onChoose}:{siteId:number;onChoose?: (layout:VisualLayout,name:string)=>void}){
 const [entries,setEntries]=useState<HomepageTemplate[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
 const [selected,setSelected]=useState<string|null>(null),[width,setWidth]=useState(1200),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false);
 const sequence=useRef(0),previewRef=useRef<HTMLDivElement>(null),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;sequence.current++;};},[]);
 async function load(){const ticket=++sequence.current;setLoading(true);setError("");setEntries([]);setSelected(null);setConfirm(false);
 try{const result=await loadHomepageTemplates(siteId);if(!alive.current||ticket!==sequence.current)return;if(!result.ok)throw new Error(result.error.message);setEntries(result.data);}
 catch(e){if(alive.current&&ticket===sequence.current)setError(e instanceof Error?e.message:"Templates could not be loaded.");}
 finally{if(alive.current&&ticket===sequence.current)setLoading(false);}}
 useEffect(()=>{void load();},[siteId]);
 async function choose(){const entry=entries.find(item=>item.id===selected);if(!entry||!entry.available||!onChoose)return;setBusy(true);setError("");
 try{const result=await prepareHomepageTemplate(siteId,entry.id,entry.version);if(!alive.current)return;if(!result.ok)throw new Error(result.error.message);onChoose(result.data,entry.name);setConfirm(false);}
 catch(e){if(alive.current)setError(e instanceof Error?e.message:"The template could not be prepared.");}finally{if(alive.current)setBusy(false);}}
 const entry=entries.find(item=>item.id===selected);
 return <Box component="section" aria-label="Homepage starting templates" sx={{display:"grid",gap:2,minWidth:0}}>
 <Box><Typography variant="overline" color="primary">A starting point for your Site</Typography><Typography component="h2" variant="h5" fontWeight={800}>Homepage templates</Typography>
 <Typography color="text.secondary">Explore approved layouts. Previewing never changes a Page, publication or homepage assignment.</Typography></Box>
 {loading?<Box role="status"><CircularProgress size={20}/> Loading templates...</Box>:null}
 {error?<Alert severity="error" action={<Button disabled={busy} onClick={()=>void load()}>Retry catalogue</Button>}>{error}</Alert>:null}
 <Box sx={{display:"grid",gridTemplateColumns:{xs:"minmax(0,1fr)",md:"repeat(3,minmax(0,1fr))"},gap:2}}>
 {entries.map((item,index)=><Paper key={item.id} variant="outlined" sx={{overflow:"hidden",borderRadius:3,borderColor:selected===item.id?"primary.main":"divider",display:"flex",flexDirection:"column"}}>
 <Box aria-hidden="true" sx={{p:2,bgcolor:index===0?"#e8eef8":index===1?"#f0f3ed":"#f5f6f8",height:125,display:"grid",gap:1}}>
 <Box sx={{height:12,width:"40%",borderRadius:1,bgcolor:"#607795"}}/>
 {item.id!=="blank"?<><Box sx={{bgcolor:index===0?"#153154":"#31534d",borderRadius:1.5,height:44}}/><Box sx={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:1}}>{[1,2,3].map(i=><Box key={i} sx={{bgcolor:"#fff",borderRadius:1,height:22}}/>)}</Box></>:<Box sx={{border:"1px dashed #8392a4",borderRadius:1}}/>}</Box>
 <Box sx={{p:2,display:"grid",gap:1,flex:1}}><Typography component="h3" variant="h6">{item.name}</Typography><Typography variant="body2" color="text.secondary">{item.description}</Typography>
 <Typography variant="caption">Template v{item.version} | Builder schema {item.layout?.schema_version??"unsupported"}</Typography>
 <Chip size="small" label={item.available?"Compatible":"Unavailable"} color={item.available?"success":"default"} sx={{justifySelf:"start"}}/>
 {item.unavailable_reasons.map(reason=><Typography key={reason} variant="body2" color="error">{reason}</Typography>)}
 <Button variant={selected===item.id?"contained":"outlined"} disabled={!item.available||!item.layout||busy} onClick={()=>{setSelected(item.id);setConfirm(false);requestAnimationFrame(()=>previewRef.current?.focus());}}>Preview {item.name}</Button></Box></Paper>)}
 </Box>
 {entry?.layout&&entry.available?<Paper ref={previewRef} tabIndex={-1} variant="outlined" aria-label={`${entry.name} template preview`} sx={{p:{xs:1.5,md:3},borderRadius:3,minWidth:0,"&:focus-visible":{outline:"3px solid",outlineColor:"primary.main"}}}>
 <Box sx={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:1,mb:2}}><Box><Typography component="h3" variant="h6">{entry.name} preview</Typography><Typography variant="body2">Sample content only. Replace it with approved Site content before publishing.</Typography></Box><Box aria-label="Preview width" sx={{display:"flex",gap:1}}>{[[1200,"Desktop"],[390,"Mobile"]].map(([value,label])=><Button key={value} aria-pressed={width===value} onClick={()=>setWidth(Number(value))}>{label}</Button>)}</Box></Box>
 <Box sx={{maxWidth:width,width:"100%",mx:"auto",p:2,bgcolor:"background.default",border:"1px solid",borderColor:"divider",borderRadius:2,overflowWrap:"anywhere"}} onClickCapture={event=>{if((event.target as HTMLElement).closest("a"))event.preventDefault();}}>
 {entry.layout.rows.length?<VisualLayoutView layout={entry.layout} siteId={null} pageTitle={entry.name} viewportWidth={width}/>:<Box sx={{py:8,textAlign:"center"}}><Typography variant="h6">Your blank canvas</Typography><Typography color="text.secondary">An empty, valid layout ready for your first row.</Typography></Box>}</Box>
 {onChoose?<Box sx={{mt:2}}>{confirm?<Alert severity="warning">Replace the current canvas with {entry.name}? Existing content remains recoverable through undo until save. Publication is unchanged.<Box sx={{display:"flex",gap:1,mt:1}}><Button variant="contained" disabled={busy} onClick={()=>void choose()}>{busy?"Preparing...":"Confirm template selection"}</Button><Button disabled={busy} onClick={()=>setConfirm(false)}>Cancel</Button></Box></Alert>:<Button variant="contained" disabled={busy} onClick={()=>setConfirm(true)}>Use {entry.name} in this draft</Button>}</Box>:<Typography sx={{mt:2}} variant="body2">To use a template, open an existing Page's Visual Builder and choose Homepage templates. Save, review, publish and assign it through the existing Page workflow.</Typography>}
 </Paper>:null}
 </Box>;
}
