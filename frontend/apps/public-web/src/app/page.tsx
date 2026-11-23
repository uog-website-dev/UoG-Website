"use client";

/** Host-resolved published homepage. Operational diagnostics belong in administration. */
import {useEffect,useState} from "react";
import {Alert,Box,Button,CircularProgress,Typography} from "@mui/material";
import {pageFromResponse,pageMetadata,PublicPageView,publicFetchInit,sameSite,usePublicSiteBranding} from "@uog/ui";
import type {PublicPageDocument} from "@uog/ui";

export default function HomePage(){
 const site=usePublicSiteBranding();
 const [homepage,setHomepage]=useState<PublicPageDocument|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 useEffect(()=>{
  const controller=new AbortController();
  setHomepage(null);setError("");
  if(!site.id||!site.modules.pages){setLoading(false);return ()=>controller.abort();}
  setLoading(true);
  fetch("/api/v1/site-context/homepage/",{...publicFetchInit(),signal:controller.signal})
   .then(async response=>{
    if(!response.ok&&response.status!==404)throw new Error("The homepage is temporarily unavailable.");
    const body=response.ok?await response.json():null;
    if(!controller.signal.aborted)setHomepage(pageFromResponse(response.status,body));
   })
   .catch(()=>{if(!controller.signal.aborted)setError("The homepage is temporarily unavailable.");})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[site.id,site.modules.pages]);
 const visible=site.modules.pages&&homepage&&sameSite(homepage.site,site.id)?homepage:null;
 useEffect(()=>{
  if(!site.id||!visible)return;
  const metadata=pageMetadata(site,visible);document.title=metadata.title;
  let description=document.querySelector('meta[name="description"]');
  if(!description){description=document.createElement("meta");description.setAttribute("name","description");document.head.appendChild(description);}
  description.setAttribute("content",metadata.description);
 },[site,visible]);
 return <Box sx={{minWidth:0,width:"100%",overflowWrap:"anywhere"}}>
  {!site.id?<Alert severity="warning">No Site is configured for this hostname.</Alert>
   :loading?<Box role="status" sx={{display:"flex",alignItems:"center",gap:2,py:4}}><CircularProgress size={24}/><Typography>Loading homepage...</Typography></Box>
   :error?<Alert severity="warning" action={<Button onClick={()=>location.reload()}>Retry</Button>}>{error}</Alert>
   :<PublicPageView page={visible}/>}
 </Box>;
}
