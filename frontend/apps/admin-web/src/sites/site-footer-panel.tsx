"use client";
import {useEffect,useState} from "react";
import {Alert,Box,Button,CircularProgress,IconButton,MenuItem,Paper,TextField,Typography} from "@mui/material";
import {ThemeProvider} from "@mui/material/styles";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import Link from "next/link";
import {defaultSiteFooter,FOOTER_SOCIAL_PLATFORMS,footerSettingsFrom} from "@uog/types";
import type {SiteFooterSettings,FooterSocialPlatform} from "@uog/types";
import {EMPTY_SITE,PublicSiteFooter,FormErrorSummary,fieldErrorsFrom,uogTheme,highContrastTheme} from "@uog/ui";
import {getSiteFooter,publishSiteFooter,restorePreviousSiteFooter,updateSiteFooter} from "@/app/sites/footer-actions";
import type {LintWarning,SiteFooterEnvelope} from "@/app/sites/footer-actions";
import {deserializeApiError,unwrap} from "@/organizations/contract";
import {APP_BASE_PATH} from "@/base-path";
import {useSiteAdmin} from "./site-admin-frame";
import {siteAdminHref} from "./site-admin";
import {useSiteDraftGuard} from "./site-draft-guard";
import {logoAssetId} from "./validation";

const names:Record<FooterSocialPlatform,string>={x:"X",youtube:"YouTube",facebook:"Facebook",linkedin:"LinkedIn",telegram:"Telegram",tiktok:"TikTok",instagram:"Instagram"};
export function SiteFooterPanel(){const {site}=useSiteAdmin();return <FooterEditor key={site.id} siteId={site.id}/>;}
function FooterEditor({siteId}:{siteId:number}) {
 const admin=useSiteAdmin();
 const [loaded,setLoaded]=useState<SiteFooterEnvelope|null>(null),[etag,setEtag]=useState<string|null>(null);
 const [values,setValues]=useState(defaultSiteFooter),[saved,setSaved]=useState<SiteFooterSettings|null>(null);
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[attempt,setAttempt]=useState(0);
 const [publishing,setPublishing]=useState(false),[restoring,setRestoring]=useState(false),[warnings,setWarnings]=useState<LintWarning[]>([]);
 const [error,setError]=useState(""),[notice,setNotice]=useState(""),[errors,setErrors]=useState<Record<string,string>>({});
 const dirty=saved!==null&&JSON.stringify(values)!==JSON.stringify(saved);
 useSiteDraftGuard(dirty);
 useEffect(()=>{if(!dirty)return;const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);},[dirty]);
 useEffect(()=>{
  let active=true;setLoading(true);setError("");setNotice("");
  void getSiteFooter(siteId).then(result=>{const response=unwrap(result);if(!active)return;if(response.data.site!==siteId)throw new Error("Footer belongs to another Site.");
   const next=footerSettingsFrom(response.data.settings);
   // Legacy rows have no explicit column copy yet: seed the editor from the
   // merged published menus so headings can be reviewed without a silent write.
   if(response.data.columns.length)next.columns=response.data.columns.map(column=>({menu:column.menu,heading:next.columns.find(item=>item.menu===column.menu)?.heading??column.heading,description:next.columns.find(item=>item.menu===column.menu)?.description??column.description}));
   setLoaded(response.data);setEtag(response.etag);setValues(next);setSaved(next);})
   .catch(cause=>{if(active)setError(cause instanceof Error?cause.message:"Footer could not be loaded.");}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[siteId,attempt]);
 async function save(event:React.FormEvent){
  event.preventDefault();if(!etag||saving)return;setSaving(true);setError("");setErrors({});setNotice("");
  try{
   const result=await updateSiteFooter(siteId,etag,values);
   if(!result.ok){setErrors(fieldErrorsFrom(deserializeApiError(result.error)));throw new Error([409,412,428].includes(result.error.status)?"Footer changed in another session. Your edits are preserved. Reload current settings before saving again.":result.error.message);}
   if(result.data.data.site!==siteId)throw new Error("Unexpected Site response.");
   const next=footerSettingsFrom(result.data.data.settings);setValues(next);setSaved(next);setEtag(result.data.etag);setLoaded(result.data.data);setWarnings([]);
   setNotice("Footer draft saved. Nothing is public until you publish it.");
  }catch(cause){setError(cause instanceof Error?cause.message:"Save failed. Your edits are preserved.");}finally{setSaving(false);}
 }
 function applyResponse(data:SiteFooterEnvelope,etag:string|null,message:string){const next=footerSettingsFrom(data.settings);setValues(next);setSaved(next);setEtag(etag);setLoaded(data);setNotice(message);}
 async function publish(){
  if(!etag||publishing||saving||dirty)return;setPublishing(true);setError("");setErrors({});setNotice("");setWarnings([]);
  try{
   const result=await publishSiteFooter(siteId,etag);
   if(!result.ok){setErrors(fieldErrorsFrom(deserializeApiError(result.error)));throw new Error([409,412,428].includes(result.error.status)?"Footer changed in another session. Your edits are preserved. Reload before publishing again.":result.error.message);}
   applyResponse(result.data.data,result.data.etag,"Footer published. Visitors now see these values.");setWarnings(result.data.data.lint_warnings??[]);
  }catch(cause){setError(cause instanceof Error?cause.message:"Publish failed. Your draft is unchanged.");}finally{setPublishing(false);}
 }
 async function restore(){
  if(!etag||restoring||saving||!loaded?.previous_available)return;
  if(!window.confirm("Copy the previous published footer into this draft? Visitors keep seeing the current publication until you publish again."))return;
  setRestoring(true);setError("");setErrors({});setNotice("");
  try{
   const result=await restorePreviousSiteFooter(siteId,etag);
   if(!result.ok){setErrors(fieldErrorsFrom(deserializeApiError(result.error)));throw new Error([409,412,428].includes(result.error.status)?"Footer changed in another session. Reload before restoring.":result.error.message);}
   applyResponse(result.data.data,result.data.etag,"Previous published footer restored into the draft. Publish to make it public again.");
  }catch(cause){setError(cause instanceof Error?cause.message:"Restore failed. Your draft is unchanged.");}finally{setRestoring(false);}
 }
 function moveColumn(index:number,delta:number){setValues(previous=>{const columns=[...previous.columns];const target=index+delta;if(target<0||target>=columns.length)return previous;[columns[index],columns[target]]=[columns[target]!,columns[index]!];return {...previous,columns};});}
 const set=(key:Exclude<keyof SiteFooterSettings,"social_links"|"columns">,value:string)=>setValues(previous=>({...previous,[key]:value}));
 function text(key:Exclude<keyof SiteFooterSettings,"social_links"|"columns">,label:string,options:{max?:number;multiline?:boolean;helper?:string;type?:string}={}){
  return <TextField id={`footer-${key}`} label={label} type={options.type??"text"} value={values[key]} disabled={saving} onChange={event=>set(key,event.target.value)} multiline={options.multiline} minRows={options.multiline?2:undefined} fullWidth error={Boolean(errors[key])} helperText={errors[key]??options.helper} slotProps={{htmlInput:{maxLength:options.max??300}}}/>;
 }
 const reorder=(index:number,delta:number)=>setValues(previous=>{const links=[...previous.social_links];const target=index+delta;[links[index],links[target]]=[links[target]!,links[index]!];return {...previous,social_links:links};});
 if(loading)return <Box role="status" sx={{display:"flex",alignItems:"center",gap:2}}><CircularProgress size={24}/>Loading footer…</Box>;
 if(!loaded||!saved)return <Alert severity="error" action={<Button onClick={()=>setAttempt(value=>value+1)}>Retry</Button>}>{error}</Alert>;
 const site={...EMPTY_SITE,id:siteId,name:admin.site.name,displayName:loaded.branding.name,theme:loaded.branding.theme};
 const asset=logoAssetId(loaded.branding.logo_asset_id);
 return <Box sx={{display:"grid",gap:3}}>
  <Box><Typography component="h1" variant="h4">Footer</Typography><Typography color="text.secondary">Contact information, social profiles and footer content for {admin.site.name}.</Typography></Box>
  <Paper component="form" noValidate onSubmit={save} variant="outlined" sx={{p:{xs:2,md:3},display:"grid",gap:3}}>
   {error?<Alert severity="error">{error}</Alert>:null}<FormErrorSummary errors={errors}/>{notice?<Alert severity="success" role="status">{notice}</Alert>:null}
   <Box sx={{display:"grid",gridTemplateColumns:{xs:"1fr",md:"1fr 1fr"},gap:3}}>
    <Box sx={{display:"grid",gap:2,alignContent:"start"}}><Typography component="h2" variant="h6">About and copyright</Typography>
     {text("description","Short description",{multiline:true,max:600,helper:"Optional introduction beneath the Site logo. Plain text only."})}
     {text("links_heading","Heading for ungrouped links",{max:80})}
     {text("copyright_text","Copyright text",{max:300,helper:"Use {year} for the current year and {site} for the public Site title."})}
    </Box>
    <Box sx={{display:"grid",gap:2,alignContent:"start"}}><Typography component="h2" variant="h6">Contact information</Typography>
     {text("address","Address",{multiline:true})}{text("email","Public email",{type:"email",max:254})}{text("phone","Phone",{type:"tel",max:48,helper:"Optional telephone number, including country code."})}
    </Box>
   </Box>
   <Box sx={{display:"grid",gap:2}}><Typography component="h2" variant="h6">Radio or featured link</Typography><Box sx={{display:"grid",gridTemplateColumns:{xs:"1fr",md:"1fr 1fr"},gap:2}}>{text("highlight_label","Featured label",{max:80,helper:"Optional, for example your campus radio station."})}{text("highlight_url","Featured URL",{max:2048,helper:"Optional HTTP or HTTPS destination."})}</Box></Box>
   <Box sx={{display:"grid",gap:2}}><Typography component="h2" variant="h6">Newsletter and support</Typography><Typography variant="body2">Use your approved hosted newsletter signup form and support/chat service. Links stay hidden until configured; this Site does not collect subscription addresses.</Typography>
    {text("newsletter_label","Newsletter link label",{max:120})}{text("newsletter_url","Newsletter signup URL",{max:2048,helper:"HTTPS hosted subscription form, for example your institution's Brevo form."})}
    {text("support_label","Support link label",{max:120})}{text("support_url","Support or chat URL",{max:2048,helper:"HTTPS institutional helpdesk or approved chat destination."})}
   </Box>
   <Box sx={{display:"grid",gap:2}}><Typography component="h2" variant="h6">Social profiles</Typography><Typography variant="body2" color="text.secondary">Only configured profiles appear publicly. Move them to choose their display order.</Typography>
    {values.social_links.map((link,index)=><Box key={index} sx={{display:"flex",alignItems:"flex-start",gap:1,flexWrap:{xs:"wrap",md:"nowrap"}}}>
     <TextField select id={`footer-social-platform-${index}`} label={`Platform ${index+1}`} value={link.platform} disabled={saving} onChange={event=>setValues(previous=>({...previous,social_links:previous.social_links.map((item,position)=>position===index?{...item,platform:event.target.value as FooterSocialPlatform}:item)}))} sx={{width:{xs:"100%",md:170},flexShrink:0}}>{FOOTER_SOCIAL_PLATFORMS.map(platform=><MenuItem key={platform} value={platform} disabled={values.social_links.some((item,position)=>position!==index&&item.platform===platform)}>{names[platform]}</MenuItem>)}</TextField>
     <TextField id={`footer-social-url-${index}`} label={`${names[link.platform]} profile URL`} value={link.url} disabled={saving} onChange={event=>setValues(previous=>({...previous,social_links:previous.social_links.map((item,position)=>position===index?{...item,url:event.target.value}:item)}))} error={Boolean(errors[`social_links.${index}.url`])} helperText={errors[`social_links.${index}.url`]??"HTTPS URL"} sx={{flex:1,minWidth:{xs:"100%",md:180}}}/>
     <Box sx={{display:"flex"}}><IconButton aria-label={`Move ${names[link.platform]} up`} disabled={saving||index===0} onClick={()=>reorder(index,-1)}><ArrowUpwardIcon/></IconButton><IconButton aria-label={`Move ${names[link.platform]} down`} disabled={saving||index===values.social_links.length-1} onClick={()=>reorder(index,1)}><ArrowDownwardIcon/></IconButton><IconButton aria-label={`Remove ${names[link.platform]}`} disabled={saving} onClick={()=>setValues(previous=>({...previous,social_links:previous.social_links.filter((_,position)=>position!==index)}))}><DeleteOutlineIcon/></IconButton></Box>
    </Box>)}
    <Box><Button disabled={saving||values.social_links.length>=7} onClick={()=>{const platform=FOOTER_SOCIAL_PLATFORMS.find(candidate=>!values.social_links.some(link=>link.platform===candidate));if(platform)setValues(previous=>({...previous,social_links:[...previous.social_links,{platform,url:""}]}));}}>Add social profile</Button></Box>
   </Box>
      <Box sx={{display:"grid",gap:2}}><Typography component="h2" variant="h6">Legal and accessibility links</Typography><Typography variant="body2" color="text.secondary">Footer links for privacy, accessibility, terms or related policies. They open safely in a new tab when external.</Typography>
    {values.legal_links.map((link,index)=><Box key={index} sx={{display:"flex",gap:1,flexWrap:{xs:"wrap",md:"nowrap"}}}>
     <TextField id={`footer-legal-label-${index}`} label={`Link ${index+1} label`} value={link.label} disabled={saving} onChange={event=>setValues(previous=>({...previous,legal_links:previous.legal_links.map((item,position)=>position===index?{...item,label:event.target.value}:item)}))} sx={{width:{xs:"100%",md:240}}}/>
     <TextField id={`footer-legal-url-${index}`} label={`Link ${index+1} URL`} value={link.url} disabled={saving} onChange={event=>setValues(previous=>({...previous,legal_links:previous.legal_links.map((item,position)=>position===index?{...item,url:event.target.value}:item)}))} error={Boolean(errors[`legal_links.${index}.url`]||errors[`legal_links.${index}.label`])} helperText={errors[`legal_links.${index}.url`]??errors[`legal_links.${index}.label`]??"HTTP or HTTPS URL"} sx={{flex:1,minWidth:{xs:"100%",md:180}}}/>
     <IconButton aria-label={`Remove legal link ${index+1}`} disabled={saving} onClick={()=>setValues(previous=>({...previous,legal_links:previous.legal_links.filter((_,position)=>position!==index)}))}><DeleteOutlineIcon/></IconButton>
    </Box>)}
    <Box><Button disabled={saving||values.legal_links.length>=10} onClick={()=>setValues(previous=>({...previous,legal_links:[...previous.legal_links,{label:"",url:""}]}))}>Add legal or accessibility link</Button></Box>
   </Box>
   <Box sx={{display:"grid",gap:2}}><Typography component="h2" variant="h6">Footer columns</Typography>
    <Typography variant="body2" color="text.secondary">These public headings are independent of the internal menu names. Keep the menu names for your team; visitors see the headings and descriptions here. Assign or reorder menus in Menus, then use the arrows below to set the public order.</Typography>
    {values.columns.map((column,index)=>{
     const menuName=loaded.columns.find(row=>row.menu===column.menu)?.menu_name??"Unavailable Site menu";
     return <Box key={`${column.menu??"column"}-${index}`} sx={{display:"grid",gap:1.5,p:2,border:1,borderColor:"divider",borderRadius:2}}>
      <Box sx={{display:"flex",alignItems:"center",gap:1,flexWrap:"wrap"}}><Typography variant="subtitle2">Column {index+1} · links from “{menuName}”</Typography><Box sx={{ml:"auto",display:"flex"}}><IconButton aria-label={`Move column ${index+1} up`} disabled={saving||publishing||index===0} onClick={()=>moveColumn(index,-1)}><ArrowUpwardIcon/></IconButton><IconButton aria-label={`Move column ${index+1} down`} disabled={saving||publishing||index===values.columns.length-1} onClick={()=>moveColumn(index,1)}><ArrowDownwardIcon/></IconButton></Box></Box>
      <TextField id={`footer-column-heading-${index}`} label={`Column ${index+1} public heading`} value={column.heading} disabled={saving||publishing} onChange={event=>setValues(previous=>({...previous,columns:previous.columns.map((item,position)=>position===index?{...item,heading:event.target.value}:item)}))} error={Boolean(errors[`columns.${index}.heading`])} helperText={errors[`columns.${index}.heading`]??"Shown to visitors. Renaming the menu never changes it."} slotProps={{htmlInput:{maxLength:80}}}/>
      <TextField id={`footer-column-description-${index}`} label={`Column ${index+1} description`} value={column.description} disabled={saving||publishing} onChange={event=>setValues(previous=>({...previous,columns:previous.columns.map((item,position)=>position===index?{...item,description:event.target.value}:item)}))} error={Boolean(errors[`columns.${index}.description`])} helperText={errors[`columns.${index}.description`]??"Optional line beneath the heading."} slotProps={{htmlInput:{maxLength:300}}}/>
     </Box>;
    })}
    {!values.columns.length?<Alert severity="info">No footer menu columns are assigned yet. Publish a Footer menu assignment in Menus to add a column here.</Alert>:null}
   </Box>
   <Alert severity="info">Footer settings save as a private draft. Publish footer to make them public; menu links follow the existing Menus publish workflow.</Alert>
   {loaded.published_at?<Typography variant="body2" color="text.secondary">Published {new Date(loaded.published_at).toLocaleString()}{loaded.has_unpublished_changes?" · a newer draft has not been published":""}</Typography>:<Typography variant="body2" color="text.secondary">This footer has not been published yet. Visitors see the default footer.</Typography>}
   {warnings.length?<Alert severity="warning" role="status"><Typography variant="subtitle2">Published with warnings</Typography>{warnings.map(warning=><Typography key={warning.path} variant="body2">{warning.path}: {warning.message}</Typography>)}</Alert>:null}
   <Box sx={{display:"flex",gap:2,flexWrap:"wrap"}}>
    <Button type="submit" variant="contained" disabled={saving||publishing||!dirty||!etag}>{saving?"Saving…":"Save draft"}</Button>
    <Button variant="contained" color="secondary" disabled={saving||publishing||restoring||dirty||!etag} onClick={()=>void publish()}>{publishing?"Publishing…":"Publish footer"}</Button>
    <Button disabled={saving||publishing||restoring||!etag||!loaded.previous_available} onClick={()=>void restore()}>{restoring?"Restoring…":"Restore previous published footer"}</Button>
    <Button disabled={saving||publishing||restoring} onClick={()=>{if(!dirty||window.confirm("Discard unsaved footer settings and reload?"))setAttempt(value=>value+1);}}>Reload current settings</Button>
    {admin.enabledModuleCodes.includes("MENUS")?<Button component={Link} href={siteAdminHref(siteId,"menus")}>Manage footer menus</Button>:null}
   </Box>
   {dirty?<Typography variant="caption" color="text.secondary">Save the draft before publishing. Publish is disabled while unsaved edits exist.</Typography>:null}
  </Paper>
  <Box component="section" aria-label="Footer preview" sx={{minWidth:0}}><Typography component="h2" variant="h6" sx={{mb:1}}>Draft preview</Typography><Typography variant="body2" color="text.secondary">Your draft values with this Site’s currently published footer links. Visitors see the published footer, not this preview. Preview links open in a new tab.</Typography>
   <ThemeProvider theme={site.theme==="high-contrast"?highContrastTheme:uogTheme}><PublicSiteFooter site={site} items={loaded.menu_items} settings={values} preview siteOrigin={loaded.site_origin??undefined} previewLogo={asset?{assetId:asset,mediaBase:`${APP_BASE_PATH}/sites/${siteId}/media`}:undefined}/></ThemeProvider>
  </Box>
 </Box>;
}
