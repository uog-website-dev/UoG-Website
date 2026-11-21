"use client";

import {useEffect,useState} from "react";
import {Alert,Box,Button,CircularProgress,MenuItem,Paper,TextField,Typography} from "@mui/material";
import {fieldErrorsFrom,FormErrorSummary} from "@uog/ui";
import type {SiteTheme} from "@uog/types";
import {getSite,updateSiteConfiguration} from "@/app/sites/actions";
import {deserializeApiError,unwrap} from "@/organizations/contract";
import {useSiteAdmin} from "./site-admin-frame";
import {useSiteDraftGuard} from "./site-draft-guard";
import {logoAssetId} from "./validation";
import {SiteImageField} from "./site-image-field";

type Values={title:string;logo:string|null;theme:SiteTheme};
export function SiteAppearancePanel() {
  const {site}=useSiteAdmin();
  return <AppearanceForm key={site.id} siteId={site.id} siteName={site.name}/>;
}
function AppearanceForm({siteId,siteName}:{siteId:number;siteName:string}) {
  const [values,setValues]=useState<Values>({title:"",logo:null,theme:"institutional"});
  const [saved,setSaved]=useState<Values|null>(null);
  const [etag,setEtag]=useState<string|null>(null);
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
  const [attempt,setAttempt]=useState(0),[error,setError]=useState("");
  const [fields,setFields]=useState<Record<string,string>>({});
  const [message,setMessage]=useState("");
  const dirty=saved!==null&&JSON.stringify(values)!==JSON.stringify(saved);
  useSiteDraftGuard(dirty);
  useEffect(()=>{
    if(!dirty)return;
    const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",guard);
    return ()=>window.removeEventListener("beforeunload",guard);
  },[dirty]);
  useEffect(()=>{
    let active=true;setLoading(true);setError("");setMessage("");
    void getSite(siteId).then(result=>{
      const current=unwrap(result);if(!active)return;
      if(current.data.id!==siteId)throw new Error("Appearance does not belong to this Site.");
      const config=current.data.configuration;
      const next={title:config.identity.display_name??"",logo:logoAssetId(config.identity.logo_ref),theme:config.presentation.theme};
      setValues(next);setSaved(next);setEtag(current.etag);
    }).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:"Appearance could not be loaded.");})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[siteId,attempt]);
  async function save(event:React.FormEvent) {
    event.preventDefault();if(!etag||saving)return;
    setSaving(true);setError("");setFields({});setMessage("");
    try {
      const result=await updateSiteConfiguration(siteId,etag,{
        identity:{display_name:values.title.trim()||null,logo_ref:values.logo},presentation:{theme:values.theme},
      });
      if(!result.ok){
        setFields(fieldErrorsFrom(deserializeApiError(result.error)));
        throw new Error([409,412,428].includes(result.error.status)
          ? "Appearance changed in another session. Your edits are preserved. Reload current settings before saving again."
          : result.error.message);
      }
      const current=result.data;if(current.data.id!==siteId)throw new Error("Unexpected Site response.");
      const config=current.data.configuration;
      const next={title:config.identity.display_name??"",logo:logoAssetId(config.identity.logo_ref),theme:config.presentation.theme};
      setValues(next);setSaved(next);setEtag(current.etag);
      setMessage("Appearance saved for this Site. Public pages update on reload or when their tab returns to the foreground.");
    } catch(cause){setError(cause instanceof Error?cause.message:"Save failed. Your edits are preserved; try again.");}
    finally{setSaving(false);}
  }
  if(loading)return <Box role="status" sx={{display:"flex",gap:2,alignItems:"center"}}><CircularProgress size={24}/>Loading appearance…</Box>;
  if(!saved)return <Alert severity="error" action={<Button onClick={()=>setAttempt(v=>v+1)}>Retry</Button>}>{error}</Alert>;
  return <Paper component="form" variant="outlined" onSubmit={save} sx={{p:{xs:2,md:4},maxWidth:880,display:"grid",gap:3}}>
    <Box><Typography component="h1" variant="h4">Appearance</Typography><Typography color="text.secondary">Public branding for {siteName}. These settings apply across this Site; other Sites and platform defaults are unchanged.</Typography></Box>
    {error?<Alert severity="error">{error}</Alert>:null}
    <FormErrorSummary errors={fields}/>
    {message?<Alert severity="success" role="status">{message}</Alert>:null}
    <TextField id="site-appearance-title" label="Public Site title" value={values.title} disabled={saving} onChange={e=>setValues(v=>({...v,title:e.target.value}))} error={Boolean(fields["identity.display_name"])} helperText={fields["identity.display_name"]??"Leave blank to use the Site name."}/>
    <SiteImageField siteId={siteId} label="Site logo" optional canUpload editAltText={false} disabled={saving} value={{assetId:values.logo,alt:values.title||siteName}} onChange={next=>setValues(v=>({...v,logo:next.assetId}))} helperText={fields["identity.logo_ref"]??"Choose a ready image from this Site’s Media Library. Without a logo, the approved UoG text mark is used."}/>
    <TextField id="site-appearance-theme" select label="Theme" value={values.theme} disabled={saving} onChange={e=>setValues(v=>({...v,theme:e.target.value as SiteTheme}))} error={Boolean(fields["presentation.theme"])} helperText={fields["presentation.theme"]??"Approved color palettes only. Custom CSS and JavaScript are not accepted."}>
      <MenuItem value="institutional">Institutional — navy and gold</MenuItem><MenuItem value="high-contrast">High contrast — black, white and yellow</MenuItem>
    </TextField>
    <Box sx={{display:"flex",flexWrap:"wrap",gap:2}}><Button type="submit" variant="contained" disabled={saving||!dirty||!etag}>{saving?"Saving…":"Save appearance"}</Button><Button disabled={saving} onClick={()=>{if(!dirty||window.confirm("Discard unsaved appearance changes and reload?"))setAttempt(v=>v+1);}}>Reload current settings</Button></Box>
  </Paper>;
}
