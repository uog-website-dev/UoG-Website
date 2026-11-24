"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {Alert,Box,Button,CircularProgress,FormControlLabel,MenuItem,Paper,Switch,TextField,Typography} from "@mui/material";
import {ThemeProvider} from "@mui/material/styles";
import {defaultSiteHeader,headerSettingsFrom} from "@uog/types";
import type {SiteHeaderSettings} from "@uog/types";
import {EMPTY_SITE,PublicSiteHeader,FormErrorSummary,fieldErrorsFrom,uogTheme,highContrastTheme} from "@uog/ui";
import {getSiteHeader,publishSiteHeader,restorePreviousSiteHeader,updateSiteHeader} from "@/app/sites/header-actions";
import type {LintWarning,SiteHeaderEnvelope} from "@/app/sites/header-actions";
import {deserializeApiError,unwrap} from "@/organizations/contract";
import {APP_BASE_PATH} from "@/base-path";
import {useSiteAdmin} from "./site-admin-frame";
import {siteAdminHref} from "./site-admin";
import {useSiteDraftGuard} from "./site-draft-guard";
import {logoAssetId} from "./validation";

type PreviewViewport = "desktop" | "mobile";
const VIEWPORT_WIDTH: Record<PreviewViewport, string> = {desktop: "100%", mobile: "390px"};

export function SiteHeaderPanel(){const {site}=useSiteAdmin();return <HeaderEditor key={site.id} siteId={site.id}/>;}

function HeaderEditor({siteId}:{siteId:number}) {
 const admin=useSiteAdmin();
 const [loaded,setLoaded]=useState<SiteHeaderEnvelope|null>(null),[etag,setEtag]=useState<string|null>(null);
 const [values,setValues]=useState<SiteHeaderSettings>(defaultSiteHeader),[saved,setSaved]=useState<SiteHeaderSettings|null>(null);
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[attempt,setAttempt]=useState(0);
 const [publishing,setPublishing]=useState(false),[restoring,setRestoring]=useState(false),[warnings,setWarnings]=useState<LintWarning[]>([]);
 const [error,setError]=useState(""),[notice,setNotice]=useState(""),[errors,setErrors]=useState<Record<string,string>>({});
 const [viewport,setViewport]=useState<PreviewViewport>("desktop");
 const dirty=saved!==null&&JSON.stringify(values)!==JSON.stringify(saved);
 useSiteDraftGuard(dirty);
 useEffect(()=>{if(!dirty)return;const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);},[dirty]);
 useEffect(()=>{
  let active=true;setLoading(true);setError("");setNotice("");
  void getSiteHeader(siteId).then(result=>{const response=unwrap(result);if(!active)return;if(response.data.site!==siteId)throw new Error("Header settings belong to another Site.");const next=headerSettingsFrom(response.data.settings);setLoaded(response.data);setEtag(response.etag);setValues(next);setSaved(next);})
   .catch(cause=>{if(active)setError(cause instanceof Error?cause.message:"Header settings could not be loaded.");}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[siteId,attempt]);
 async function save(event:React.FormEvent){
  event.preventDefault();if(!etag||saving)return;setSaving(true);setError("");setErrors({});setNotice("");
  try{
   const result=await updateSiteHeader(siteId,etag,values);
   if(!result.ok){setErrors(fieldErrorsFrom(deserializeApiError(result.error)));throw new Error([409,412,428].includes(result.error.status)?"Header settings changed in another session. Your edits are preserved. Reload current settings before saving again.":result.error.message);}
   if(result.data.data.site!==siteId)throw new Error("Unexpected Site response.");
   const next=headerSettingsFrom(result.data.data.settings);setValues(next);setSaved(next);setEtag(result.data.etag);setLoaded(result.data.data);setWarnings([]);
   setNotice("Header draft saved. Nothing is public until you publish it.");
  }catch(cause){setError(cause instanceof Error?cause.message:"Save failed. Your edits are preserved.");}finally{setSaving(false);}
 }
 function applyResponse(data:SiteHeaderEnvelope,etag:string|null,message:string){const next=headerSettingsFrom(data.settings);setValues(next);setSaved(next);setEtag(etag);setLoaded(data);setNotice(message);}
 async function publish(){
  if(!etag||publishing||saving||dirty)return;setPublishing(true);setError("");setErrors({});setNotice("");setWarnings([]);
  try{
   const result=await publishSiteHeader(siteId,etag);
   if(!result.ok){setErrors(fieldErrorsFrom(deserializeApiError(result.error)));throw new Error([409,412,428].includes(result.error.status)?"Header changed in another session. Your edits are preserved. Reload before publishing again.":result.error.message);}
   applyResponse(result.data.data,result.data.etag,"Header published. Visitors now see these values.");setWarnings(result.data.data.lint_warnings??[]);
  }catch(cause){setError(cause instanceof Error?cause.message:"Publish failed. Your draft is unchanged.");}finally{setPublishing(false);}
 }
 async function restore(){
  if(!etag||restoring||saving||!loaded?.previous_available)return;
  if(!window.confirm("Copy the previous published header into this draft? Visitors keep seeing the current publication until you publish again."))return;
  setRestoring(true);setError("");setErrors({});setNotice("");
  try{
   const result=await restorePreviousSiteHeader(siteId,etag);
   if(!result.ok){setErrors(fieldErrorsFrom(deserializeApiError(result.error)));throw new Error([409,412,428].includes(result.error.status)?"Header changed in another session. Reload before restoring.":result.error.message);}
   applyResponse(result.data.data,result.data.etag,"Previous published header restored into the draft. Publish to make it public again.");
  }catch(cause){setError(cause instanceof Error?cause.message:"Restore failed. Your draft is unchanged.");}finally{setRestoring(false);}
 }
 const set=<K extends keyof SiteHeaderSettings>(key:K,value:SiteHeaderSettings[K])=>setValues(previous=>({...previous,[key]:value}));
 if(loading)return <Box role="status" sx={{display:"flex",alignItems:"center",gap:2}}><CircularProgress size={24}/>Loading header…</Box>;
 if(!loaded||!saved)return <Alert severity="error" action={<Button onClick={()=>setAttempt(value=>value+1)}>Retry</Button>}>{error}</Alert>;
 const asset=logoAssetId(loaded.branding.logo_asset_id);
 const previewSite={...EMPTY_SITE,id:siteId,name:admin.site.name,displayName:loaded.branding.name,theme:loaded.branding.theme,
  modules:{pages:loaded.modules.includes("PAGES"),posts:loaded.modules.includes("POSTS"),menus:loaded.modules.includes("MENUS")},header:values};
 const menuState=loaded.menu_state;
 return <Box sx={{display:"grid",gap:3}}>
  <Box><Typography component="h1" variant="h4">Header</Typography><Typography color="text.secondary">Branding destination, navigation, search and the call to action for {admin.site.name}.</Typography></Box>
  <Paper component="form" noValidate onSubmit={save} variant="outlined" sx={{p:{xs:2,md:3},display:"grid",gap:3}}>
   {error?<Alert severity="error">{error}</Alert>:null}<FormErrorSummary errors={errors}/>{notice?<Alert severity="success" role="status">{notice}</Alert>:null}
   <Box sx={{display:"grid",gridTemplateColumns:{xs:"1fr",md:"1fr 1fr"},gap:3}}>
    <Box sx={{display:"grid",gap:2,alignContent:"start"}}>
     <Typography component="h2" variant="h6">Appearance</Typography>
     <TextField select id="header-variant" label="Header variant" value={values.variant ?? "standard"} disabled={saving} fullWidth
       onChange={event=>set("variant",event.target.value as SiteHeaderSettings["variant"])}
       helperText="Standard, centered or compact layout. Existing Sites keep Standard until changed."
     >
      <MenuItem value="standard">Standard</MenuItem>
      <MenuItem value="centered">Centered</MenuItem>
      <MenuItem value="compact">Compact</MenuItem>
     </TextField>
     <Typography component="h2" variant="h6">Branding</Typography>
     <TextField id="header-brand-href" label="Logo and Site name link" value={values.brand_href} disabled={saving} fullWidth required
       onChange={event=>set("brand_href",event.target.value)} error={Boolean(errors.brand_href)}
       helperText={errors.brand_href??"A same-site path such as / or an https URL. Raw HTML, CSS and JavaScript are not accepted."} slotProps={{htmlInput:{maxLength:2048}}}/>
    </Box>
    <Box sx={{display:"grid",gap:2,alignContent:"start"}}>
     <Typography component="h2" variant="h6">Call to action</Typography>
     <TextField id="header-cta-label" label="Button label" value={values.cta_label} disabled={saving} fullWidth
       onChange={event=>set("cta_label",event.target.value)} error={Boolean(errors.cta_label)}
       helperText={errors.cta_label??"Optional. Leave empty to hide the button."} slotProps={{htmlInput:{maxLength:120}}}/>
     <TextField id="header-cta-url" label="Button destination" value={values.cta_url} disabled={saving} fullWidth
       onChange={event=>set("cta_url",event.target.value)} error={Boolean(errors.cta_url)}
       helperText={errors.cta_url??"A same-site path such as /apply or an https URL."} slotProps={{htmlInput:{maxLength:2048}}}/>
    </Box>
   </Box>
   <Box sx={{display:"grid",gap:1}}>
    <Typography component="h2" variant="h6">Behaviour</Typography>
    <FormControlLabel control={<Switch checked={values.search_enabled} disabled={saving} onChange={event=>set("search_enabled",event.target.checked)}/>} label="Show Site search (also requires PAGES or POSTS)"/>
    <FormControlLabel control={<Switch checked={values.sticky} disabled={saving} onChange={event=>set("sticky",event.target.checked)}/>} label="Keep the header visible while scrolling"/>
    <FormControlLabel control={<Switch checked={values.language_switcher} disabled={saving} onChange={event=>set("language_switcher",event.target.checked)}/>} label="Show a language switcher when the public Site publishes more than one language"/>
    <Typography variant="caption" color="text.secondary">Language routing is not available on the public Site yet, so no switcher is rendered today; the setting is stored for that release.</Typography>
   </Box>
   <Box sx={{display:"grid",gap:1}}>
    <Typography component="h2" variant="h6">Navigation</Typography>
    <Typography variant="body2">Header menu: <strong>{menuState.header.published??"Unassigned"}</strong>{menuState.header.has_changes?" — a newer assignment is awaiting publication":""}</Typography>
    <Typography variant="body2">Utility menu: <strong>{menuState.utility.published??"Unassigned"}</strong>{menuState.utility.has_changes?" — a newer assignment is awaiting publication":""}</Typography>
    <Typography variant="body2" color="text.secondary">Header and utility menus use the existing Menus draft/publish workflow. This preview shows published menus only.</Typography>
    {admin.enabledModuleCodes.includes("MENUS")?<Box sx={{display:"flex",gap:1,flexWrap:"wrap"}}><Button component={Link} href={siteAdminHref(siteId,"menus")}>Manage header and utility menus</Button></Box>:null}
   </Box>
   <Alert severity="info">Header settings save as a private draft. Publish header to make them public; header and utility menus follow the existing Menus publish workflow.</Alert>
   {loaded.published_at?<Typography variant="body2" color="text.secondary">Published {new Date(loaded.published_at).toLocaleString()}{loaded.has_unpublished_changes?" · a newer draft has not been published":""}</Typography>:<Typography variant="body2" color="text.secondary">This header has not been published yet. Visitors see the default header.</Typography>}
   {warnings.length?<Alert severity="warning" role="status"><Typography variant="subtitle2">Published with warnings</Typography>{warnings.map(warning=><Typography key={warning.path} variant="body2">{warning.path}: {warning.message}</Typography>)}</Alert>:null}
   <Box sx={{display:"flex",gap:2,flexWrap:"wrap"}}>
    <Button type="submit" variant="contained" disabled={saving||publishing||!dirty||!etag}>{saving?"Saving…":"Save draft"}</Button>
    <Button variant="contained" color="secondary" disabled={saving||publishing||restoring||dirty||!etag} onClick={()=>void publish()}>{publishing?"Publishing…":"Publish header"}</Button>
    <Button disabled={saving||publishing||restoring||!etag||!loaded.previous_available} onClick={()=>void restore()}>{restoring?"Restoring…":"Restore previous published header"}</Button>
    <Button disabled={saving||publishing||restoring} onClick={()=>{if(!dirty||window.confirm("Discard unsaved header settings and reload?"))setAttempt(value=>value+1);}}>Reload current settings</Button>
   </Box>
   {dirty?<Typography variant="caption" color="text.secondary">Save the draft before publishing. Publish is disabled while unsaved edits exist.</Typography>:null}
  </Paper>
  <Box component="section" aria-label="Header preview" sx={{minWidth:0}}>
   <Box sx={{display:"flex",alignItems:"center",gap:1,flexWrap:"wrap",mb:1}}>
    <Typography component="h2" variant="h6">Live preview</Typography>
    <Box role="group" aria-label="Preview viewport" sx={{display:"flex",gap:0.5}}>
     <Button size="small" variant={viewport==="desktop"?"contained":"outlined"} aria-pressed={viewport==="desktop"} onClick={()=>setViewport("desktop")}>Desktop</Button>
     <Button size="small" variant={viewport==="mobile"?"contained":"outlined"} aria-pressed={viewport==="mobile"} onClick={()=>setViewport("mobile")}>Mobile</Button>
    </Box>
   </Box>
   <Typography variant="body2" color="text.secondary">Your draft values with this Site’s published menus. Visitors see the published header, not this preview. Preview links open in a new tab.</Typography>
   <ThemeProvider theme={loaded.branding.theme==="high-contrast"?highContrastTheme:uogTheme}>
    <Box sx={{mt:2,border:1,borderColor:"divider",borderRadius:2,overflow:"hidden",width:VIEWPORT_WIDTH[viewport],maxWidth:"100%",mx:viewport==="mobile"?"auto":0,bgcolor:"background.default"}}>
     <PublicSiteHeader site={previewSite} headerItems={loaded.menus.header} utilityItems={loaded.menus.utility} settings={values} preview siteOrigin={loaded.site_origin??undefined} previewLogo={asset?{assetId:asset,mediaBase:`${APP_BASE_PATH}/sites/${siteId}/media`}:null}/>
     <Box sx={{p:2}}><Typography variant="body2" color="text.secondary">Page content appears below the header.</Typography></Box>
    </Box>
   </ThemeProvider>
  </Box>
 </Box>;
}
