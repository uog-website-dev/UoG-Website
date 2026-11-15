"use client";
import {useEffect,useState} from "react";
import {Alert,Box,Button,TextField,Typography} from "@mui/material";
import {menusFromResponse,PublicMenuFrame,SiteNavigation,safeMenuHref,useAsync,UogThemeProvider} from "@uog/ui";
import type {PublicMenuNode} from "@uog/ui";
import {useSiteAdmin} from "@/sites/site-admin-frame";
import {loadNavigationPreview} from "@/app/sites/menu-actions";
import {unwrap} from "@/organizations/contract";
import {APP_BASE_PATH} from "@/base-path";

export function MenuPreviewScreen({menuId}:{menuId?:string}){
 const {site,enabledModuleCodes,permissions}=useSiteAdmin();
 const enabled=enabledModuleCodes.includes('MENUS'),allowed=permissions.includes('menu.write');
 const [path,setPath]=useState('/');
 useEffect(()=>setPath('/'),[site.id,menuId]);
 const state=useAsync(async()=>({site:site.id,menuId,data:enabled&&allowed?unwrap(await loadNavigationPreview(site.id,menuId)):null}),[site.id,menuId,enabled,allowed]);
 const data=enabled&&allowed&&!state.error&&state.data?.site===site.id&&state.data.menuId===menuId?state.data.data:null;
 const origin=data?.public_origin?safeMenuHref(data.public_origin)??undefined:undefined;
 function available(nodes:PublicMenuNode[]):PublicMenuNode[]{return nodes.map(node=>({...node,...(!origin&&(node.href.startsWith('/')||node.href.startsWith('#'))?{href:'',unavailable:true}:{}),children:node.children?available(node.children):[]}));}
 const parsed=menusFromResponse(200,{locations:data?.locations});
 const sidebar=available(menusFromResponse(200,{locations:{header:data?.locations?.sidebar}}).header);
 const current=path.startsWith('/')&&!path.startsWith('//')&&safeMenuHref(path)?path:'';
 return <UogThemeProvider theme={data?.theme}><Box sx={{minHeight:'100dvh',bgcolor:'background.default'}}>
  <Box component="header" sx={{p:2,borderBottom:1,borderColor:'divider',display:'flex',gap:2,flexWrap:'wrap',alignItems:'center'}}>
   <Box sx={{flex:1,minWidth:0}}><Typography component="h1" variant="h5">Draft navigation preview</Typography><Typography sx={{overflowWrap:'anywhere'}}>{data?.name??site.name}</Typography></Box>
   <Button component="a" href={`${APP_BASE_PATH}/sites/${site.id}/admin/menus`}>Back to menus</Button>
   <Button onClick={state.reload} disabled={!enabled||!allowed}>Refresh saved draft</Button>
  </Box>
  <Box sx={{p:2,display:'grid',gap:2}}>
   <Alert severity="info">This private preview uses saved menu items and assignment drafts. Save open forms before refreshing. Links open public destinations in a new tab; anonymous navigation is unchanged.</Alert>
   <TextField label="Preview current path" size="small" value={path} onChange={event=>setPath(event.target.value)} error={!current} helperText="Use a same-Site path such as /about to check the active link."/>
   {!enabled?<Alert severity="warning">The MENUS module is disabled for this Site.</Alert>:!allowed?<Alert severity="error">Menu editing permission is required to preview drafts.</Alert>:state.loading?<Typography role="status">Loading draft navigation...</Typography>:null}
   {state.error?<Alert severity="error">{state.error.message}</Alert>:null}
   {data&&!origin?<Alert severity="warning">No active primary hostname is configured. Relative links are disabled in this preview.</Alert>:null}
   {data?<Box aria-label="Draft navigation canvas" sx={{bgcolor:'background.paper',border:1,borderColor:'divider',borderRadius:2,minWidth:0,overflowWrap:'anywhere'}}>
    <PublicMenuFrame header={available(parsed.header)} footer={available(parsed.footer)} utility={available(parsed.utility??[])} siteOrigin={origin} currentPath={current} openLinksInNewTab>
     <Box sx={{p:3,display:'grid',gap:3,gridTemplateColumns:{xs:'minmax(0,1fr)',md:sidebar.length?'minmax(0,1fr) 3fr':'minmax(0,1fr)'}}}>
      {sidebar.length?<Box component="aside" aria-label="Draft Page Sidebar"><SiteNavigation items={sidebar} label="Page sidebar" siteOrigin={origin} currentPath={current} openLinksInNewTab/></Box>:null}
      <Box component="article" sx={{minHeight:220,minWidth:0}}><Typography component="h2" variant="h6">Page layout context</Typography><Typography>Unavailable destinations are shown without links. Public navigation omits those items and their descendants.</Typography>
       {!parsed.header.length&&!parsed.footer.length&&!parsed.utility?.length&&!sidebar.length?<Typography>No draft navigation items for this context.</Typography>:null}
      </Box>
     </Box>
    </PublicMenuFrame>
   </Box>:null}
  </Box>
 </Box></UogThemeProvider>;
}
