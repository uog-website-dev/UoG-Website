"use client";
import {MAX_MENU_DEPTH} from "@uog/types";
import {useEffect,useId,useMemo,useState} from "react";
import {Box,ButtonBase,Container,IconButton,Link,Typography} from "@mui/material";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import ChatBubbleOutlineRounded from "@mui/icons-material/ChatBubbleOutlineRounded";
import XIcon from "@mui/icons-material/X";
import YouTubeIcon from "@mui/icons-material/YouTube";
import FacebookIcon from "@mui/icons-material/Facebook";
import LinkedInIcon from "@mui/icons-material/LinkedIn";
import TelegramIcon from "@mui/icons-material/Telegram";
import InstagramIcon from "@mui/icons-material/Instagram";
import MusicNoteRoundedIcon from "@mui/icons-material/MusicNoteRounded";
import RadioOutlinedIcon from "@mui/icons-material/RadioOutlined";
import LocationOnOutlinedIcon from "@mui/icons-material/LocationOnOutlined";
import EmailOutlinedIcon from "@mui/icons-material/EmailOutlined";
import LocalPhoneOutlinedIcon from "@mui/icons-material/LocalPhoneOutlined";
import {footerSettingsFrom} from "@uog/types";
import type {SiteFooterSettings,FooterSocialPlatform} from "@uog/types";
import type {PublicSiteContext} from "./public-site";
import {SiteBrandingMark} from "./site-branding";
import {menusFromResponse,safeMenuHref} from "./site-navigation";
import type {PublicMenuNode} from "./site-navigation";

const platforms:Record<FooterSocialPlatform,{label:string;icon:typeof XIcon}>={
 x:{label:"X",icon:XIcon},youtube:{label:"YouTube",icon:YouTubeIcon},facebook:{label:"Facebook",icon:FacebookIcon},linkedin:{label:"LinkedIn",icon:LinkedInIcon},telegram:{label:"Telegram",icon:TelegramIcon},tiktok:{label:"TikTok",icon:MusicNoteRoundedIcon},instagram:{label:"Instagram",icon:InstagramIcon},
};
const focus={"&:focus-visible":{outline:"3px solid",outlineColor:"secondary.main",outlineOffset:3,borderRadius:.5}};
function linkUrl(value:string,origin?:string,preview=false):string|null {
 const href=safeMenuHref(value);if(!href)return null;
 if(preview&&href.startsWith("/")&&!origin)return null;
 if(href.startsWith("/")&&origin){const base=safeMenuHref(origin);if(!base)return null;try{return new URL(href,base).toString();}catch{return null;}}
 return href;
}
function FooterItems({items,origin,preview,depth}:{items:PublicMenuNode[];origin?:string;preview:boolean;depth:number}) {
 return <Box component="ul" sx={{listStyle:"none",p:0,m:0,pl:depth?1.5:0}}>
  {items.map((item,index)=>{const href=linkUrl(item.href,origin,preview);return <Box component="li" key={`${index}-${item.label}`} sx={{minWidth:0}}>
   {href?<Link href={href} target={preview?"_blank":undefined} rel={preview?"noopener noreferrer":undefined} color="inherit" underline="hover" sx={{display:"inline-flex",alignItems:"center",minHeight:44,lineHeight:1.55,fontSize:".9rem",maxWidth:"100%",overflowWrap:"anywhere",...focus}}>{item.label}</Link>:<Typography variant="body2" sx={{py:1}}>{item.label}</Typography>}
   {item.children?.length?<FooterLinks items={item.children} origin={origin} preview={preview} depth={depth+1} label={item.label}/>:null}
  </Box>;})}
 </Box>;
}
const FOOTER_LINK_LIMIT=6;
function FooterLinks({items,origin,preview,depth=0,label="footer"}:{items:PublicMenuNode[];origin?:string;preview:boolean;depth?:number;label?:string}) {
 const [all,setAll]=useState(false);const id=useId();
 if(depth>=MAX_MENU_DEPTH)return null;
 if(items.length<=FOOTER_LINK_LIMIT)return <FooterItems items={items} origin={origin} preview={preview} depth={depth}/>;
 return <>
  <FooterItems items={items.slice(0,FOOTER_LINK_LIMIT)} origin={origin} preview={preview} depth={depth}/>
  <Box id={id} sx={{display:all?"block":"none"}}><FooterItems items={items.slice(FOOTER_LINK_LIMIT)} origin={origin} preview={preview} depth={depth}/></Box>
  <ButtonBase aria-expanded={all} aria-controls={id} onClick={()=>setAll(value=>!value)} aria-label={`${all?"Show fewer":"More"} ${label} links`} sx={{minHeight:44,display:"inline-flex",alignItems:"center",gap:.5,fontSize:".9rem",fontWeight:700,textDecoration:"underline",textUnderlineOffset:"4px",borderRadius:.5,...focus}}>
   {all?"Show fewer":"More"}<ExpandMoreRoundedIcon aria-hidden sx={{fontSize:18,transform:all?"rotate(180deg)":"none",transition:"transform 150ms ease","@media (prefers-reduced-motion: reduce)":{transition:"none"}}}/>
  </ButtonBase>
 </>;
}
function FooterGroup({group,preview,siteOrigin}:{group:{title:string;description?:string;href:string;items:PublicMenuNode[]};preview:boolean;siteOrigin?:string}) {
 const [open,setOpen]=useState(false);const id=useId();const href=linkUrl(group.href,siteOrigin,preview);
 // One heading node only — a second breakpoint copy of the title inside the same
 // heading concatenated accessible names to "UniversityUniversity" in tests/jsdom.
 return <Box component="section" data-footer-group sx={{minWidth:0,borderBottom:{xs:1,md:0},borderColor:"rgba(255,255,255,.18)"}}>
  <Box sx={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:1,minWidth:0}}>
   <Typography component="h2" variant="subtitle1" sx={{m:0,flex:1,minWidth:0,fontWeight:750,lineHeight:1.45}}>
    {href?<Link href={href} color="inherit" underline="hover" target={preview?"_blank":undefined} rel={preview?"noopener noreferrer":undefined} sx={focus}>{group.title}</Link>:group.title}
   </Typography>
   <ButtonBase aria-expanded={open} aria-controls={`${id}-panel`} aria-label={`${open?"Collapse":"Expand"} ${group.title}`}
    onClick={()=>setOpen(value=>!value)} onKeyDown={event=>{if(event.key==="Escape"){event.stopPropagation();setOpen(false);}}}
    sx={{display:{xs:"inline-flex",md:"none"},flexShrink:0,alignItems:"center",justifyContent:"center",minWidth:44,minHeight:44,borderRadius:1,"&:focus-visible":{outline:"3px solid",outlineColor:"secondary.main",outlineOffset:-3}}}>
    <ExpandMoreRoundedIcon aria-hidden sx={{transform:open?"rotate(180deg)":"none",transition:"transform 150ms ease","@media (prefers-reduced-motion: reduce)":{transition:"none"}}}/>
   </ButtonBase>
  </Box>
  <Box id={`${id}-panel`} sx={{display:{xs:open?"block":"none",md:"block"},pt:{xs:1,md:0}}}>
   {group.description?<Typography variant="body2" sx={{mb:1.5,opacity:.85,lineHeight:1.6}}>{group.description}</Typography>:null}
   <Box sx={{opacity:.85}}><FooterLinks items={group.items} origin={siteOrigin} preview={preview} label={group.title}/></Box>
  </Box>
 </Box>;
}
/** One public/preview renderer for Main and child Sites. No HTML, storage keys or arbitrary icons. */
export function PublicSiteFooter({site,items=[],settings=site.footer,siteOrigin,preview=false,previewLogo}:{site:PublicSiteContext;items?:PublicMenuNode[];settings?:SiteFooterSettings;siteOrigin?:string;preview?:boolean;previewLogo?:{assetId:string;mediaBase:string}}) {
 const config=footerSettingsFrom(settings);
 const privateLogo=preview&&previewLogo&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(previewLogo.assetId)&&new RegExp(`^/(?:[A-Za-z0-9_-]+/)*sites/${site.id}/media$`).test(previewLogo.mediaBase)
  ? `${previewLogo.mediaBase}/${previewLogo.assetId}/image?variant=thumbnail`:null;
 const [logoFailed,setLogoFailed]=useState(false);useEffect(()=>setLogoFailed(false),[privateLogo]);
 const links=useMemo(()=>menusFromResponse(200,{locations:{footer:items}}).footer,[items]);
 const groups:{title:string;description?:string;href:string;items:PublicMenuNode[];flat?:boolean}[]=[];
 if(!links.some(item=>item.column||item.children?.length))groups.push({title:config.links_heading,href:"",items:links,flat:true});
 else for(const item of links){if(item.column||item.children?.length)groups.push({title:item.label,description:item.description,href:item.href,items:item.children??[]});else{const last=groups[groups.length-1];if(last?.flat)last.items.push(item);else groups.push({title:config.links_heading,href:"",items:[item],flat:true});}}
 const copyright=config.copyright_text.replaceAll("{year}",String(new Date().getFullYear())).replaceAll("{site}",site.displayName);
 return <Box component="footer" data-site-footer={site.id??"unresolved"} sx={{mt:{xs:4,md:6},bgcolor:"primary.dark",color:site.theme==="high-contrast"?"text.primary":"primary.contrastText",borderTop:1,borderColor:"rgba(255,255,255,.12)",overflowWrap:"anywhere",pb:"env(safe-area-inset-bottom)"}}>
  {config.newsletter_url&&config.newsletter_label?<Box sx={{bgcolor:'background.paper',color:'text.primary',borderBottom:1,borderColor:'divider'}}><Container maxWidth="lg" sx={{py:4,display:'flex',justifyContent:'space-between',alignItems:'center',gap:3,flexWrap:'wrap'}}><Typography component="h2" variant="h6">Stay connected with {site.displayName}</Typography><Link href={config.newsletter_url} target="_blank" rel="noopener noreferrer" aria-label={`${config.newsletter_label} (opens in a new tab)`} sx={{bgcolor:'primary.main',color:'primary.contrastText',px:3,py:1.5,borderRadius:1,fontWeight:700,...focus}}>{config.newsletter_label}</Link></Container></Box>:null}
  {config.support_url&&config.support_label?<Link href={config.support_url} target="_blank" rel="noopener noreferrer" aria-label={`${config.support_label} (opens in a new tab)`} sx={{position:preview?'static':'fixed',bottom:'calc(24px + env(safe-area-inset-bottom))',right:'calc(16px + env(safe-area-inset-right))',zIndex:1100,display:'inline-flex',alignItems:'center',gap:1,minHeight:44,p:2,borderRadius:8,boxShadow:3,bgcolor:'primary.main',color:'primary.contrastText',fontWeight:700,...focus}}><ChatBubbleOutlineRounded/>{config.support_label}</Link>:null}
  <Container maxWidth="lg" sx={{py:{xs:3,md:7}}}>
   <Box sx={{display:"grid",gridTemplateColumns:{xs:"minmax(0,1fr)",md:"minmax(200px,260px) minmax(0,1fr)"},gap:{xs:3,md:6}}}>
    <Box sx={{minWidth:0}}>
     <Link href={preview?(siteOrigin??undefined):"/"} target={preview?"_blank":undefined} rel={preview?"noopener noreferrer":undefined} color="inherit" underline="none" sx={{display:"inline-flex",flexDirection:"column",alignItems:"flex-start",gap:2,maxWidth:"100%","& img, & [role=img]":{width:{xs:96,md:180},height:{xs:96,md:180}},...focus}}>
      {preview?(privateLogo&&!logoFailed?<Box component="img" src={privateLogo} alt={`${site.displayName} logo`} onError={()=>setLogoFailed(true)} sx={{width:180,height:180,objectFit:"contain"}}/>:<SiteBrandingMark site={{...site,logoUrl:null}} size={180}/>):<SiteBrandingMark site={site} size={180}/>}<Typography component="span" variant="h6" sx={{fontWeight:750,lineHeight:1.35}}>{site.displayName}</Typography>
     </Link>
     {config.description?<Typography sx={{mt:2,fontSize:".9rem",lineHeight:1.8,opacity:.85,whiteSpace:"pre-line"}}>{config.description}</Typography>:null}
     {(config.address||config.email||config.phone)?<Box component="address" sx={{fontStyle:"normal",mt:2,display:"grid",gap:.5,fontSize:".875rem",opacity:.9}}>
      {config.address?<Box sx={{display:"flex",gap:1,py:1,alignItems:"flex-start"}}><LocationOnOutlinedIcon aria-hidden fontSize="small"/><span>{config.address}</span></Box>:null}
      {config.email?<Link href={`mailto:${encodeURIComponent(config.email)}`} color="inherit" underline="hover" sx={{display:"flex",gap:1,alignItems:"center",minHeight:44,...focus}}><EmailOutlinedIcon aria-hidden fontSize="small"/>{config.email}</Link>:null}
      {config.phone?<Link href={`tel:${config.phone.replace(/[^+0-9]/g,"")}`} color="inherit" underline="hover" sx={{display:"flex",gap:1,alignItems:"center",minHeight:44,...focus}}><LocalPhoneOutlinedIcon aria-hidden fontSize="small"/>{config.phone}</Link>:null}
     </Box>:null}
     {config.highlight_label?<Box sx={{mt:2,display:"flex",gap:1.5,alignItems:"center",minHeight:44}}><RadioOutlinedIcon aria-hidden/>{config.highlight_url?<Link href={config.highlight_url} color="inherit" underline="hover" sx={{minHeight:44,display:"inline-flex",alignItems:"center",...focus}}>{config.highlight_label}</Link>:<Typography>{config.highlight_label}</Typography>}</Box>:null}
    </Box>
    {links.length?<Box component="nav" aria-label="Footer navigation" sx={{display:"grid",gridTemplateColumns:{xs:"minmax(0,1fr)",sm:"repeat(2,minmax(0,1fr))",md:`repeat(${Math.min(Math.max(groups.length,1),4)},minmax(0,1fr))`},gap:{xs:0,sm:2,md:4},columnGap:{xs:0,sm:3},alignContent:"start"}}>
     {groups.map((group,index)=><FooterGroup key={`${index}-${group.title}`} group={group} preview={preview} siteOrigin={siteOrigin}/>)}
    </Box>:null}
   </Box>
   <Box sx={{mt:{xs:4,md:6},pt:3,borderTop:1,borderColor:"rgba(255,255,255,.2)",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:2}}>
    {config.social_links.length?<Box component="nav" aria-label="Social media" sx={{display:"flex",flexWrap:"wrap",gap:.5}}>{config.social_links.map(link=>{const {label,icon:Icon}=platforms[link.platform];return <IconButton component="a" key={link.platform} href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`${label} (opens in a new tab)`} sx={{color:"inherit",minWidth:44,minHeight:44,"&:hover":{bgcolor:"rgba(255,255,255,.12)"},...focus}}><Icon/></IconButton>;})}</Box>:null}
    {config.legal_links?.length ? <Box component="nav" aria-label="Legal and accessibility links" sx={{display:"flex",flexWrap:"wrap",gap:2,alignItems:"center"}}>{config.legal_links.map(link=>{const external=link.url.startsWith("http");return <Link key={link.label} href={link.url} target={external?"_blank":undefined} rel={external?"noopener noreferrer":undefined} color="inherit" underline="hover" aria-label={external?`${link.label} (opens in a new tab)`:undefined} sx={{minHeight:44,display:"inline-flex",alignItems:"center",...focus}}>{link.label}</Link>;})}</Box>:null}
    <Typography variant="body2" sx={{opacity:.8,ml:{md:"auto"},lineHeight:1.7}}>{copyright}</Typography>
   </Box>
  </Container>
 </Box>;
}
