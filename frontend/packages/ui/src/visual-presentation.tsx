"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import type { LayoutStyle, WidgetPropsMap } from "@uog/types";
import { BlockView } from "./public-page";
import { safeMenuHref } from "./site-navigation";

const backgrounds = {
  none:"transparent", paper:"#ffffff", mist:"#f4f7fb", navy:"#003366", blue:"#086ca4", gold:"#ffb81c",
  blue_gradient:"linear-gradient(120deg,#086ca4,#354eb8)",
  navy_gradient:"linear-gradient(120deg,#003366,#075478)",
};
const sizes = {
  sm:"clamp(1rem,2cqi,1.5rem)", md:"clamp(1.25rem,3cqi,2rem)",
  lg:"clamp(1.5rem,4cqi,3rem)", xl:"clamp(2rem,5cqi,4rem)", display:"clamp(2.25rem,6cqi,5rem)",
};

export function decorativeStyle(style:LayoutStyle={}) {
  const height={natural:"auto",compact:200,medium:360,tall:520}[style.image_height??"natural"];
  return {
    p:{none:0,sm:1.5,md:3,lg:5,xl:8}[style.padding??"none"],
    color:{default:"inherit",brand:"#003366",inverse:"#ffffff",muted:"#526174"}[style.text_color??"default"],
    ...(style.background ? {background:backgrounds[style.background]} : {}),
    borderRadius:{none:0,sm:1,md:2,lg:4,pill:12}[style.radius??"none"],
    border:style.border && style.border!=="none"?"1px solid":undefined,
    borderColor:style.border==="brand"?"#003366":"#dfe5ec",
    boxShadow:{none:0,sm:1,md:3,lg:6}[style.shadow??"none"],
    ...(style.text_size ? {"& h2,& h3,& h4":{fontSize:sizes[style.text_size],lineHeight:1.15}} : {}),
    ...(style.image_fit || style.image_height || style.image_position ? {
      "& picture":{display:"block"},
      "& img":{display:"block",width:"100%",height,objectFit:style.image_fit==="contain"?"contain":"cover",objectPosition:style.image_position??"center"},
    } : {}),
  };
}

export function PresentationLink({href,label,variant="text"}:{href:string;label:string;variant?:"text"|"solid"|"outline"}) {
  const safe=safeMenuHref(href);
  if(!safe)return <Typography component="span">{label}</Typography>;
  return <Button component="a" href={safe} variant={variant==="solid"?"contained":variant==="outline"?"outlined":"text"}
    sx={{minHeight:44,maxWidth:"100%",overflowWrap:"anywhere",textAlign:"inherit","&:focus-visible":{outline:"3px solid currentColor",outlineOffset:3}}}>{label}</Button>;
}

export function HeroView({props,siteId,width}:{props:WidgetPropsMap["hero_image"];siteId:number|null;width:number}) {
  const root=useRef<HTMLDivElement>(null);
  const [available,setAvailable]=useState(width);
  useLayoutEffect(()=>{
    if(!root.current || typeof ResizeObserver==="undefined")return;
    const element=root.current;
    const measure=()=>setAvailable(element.clientWidth || width);
    measure();
    const observer=new ResizeObserver(measure);observer.observe(element);
    return ()=>observer.disconnect();
  },[width,props.layout]);
  const mode=props.layout??"stacked";
  const split=mode==="split" || mode==="split_reverse";
  const overlay=mode==="overlay";
  const wide=available>=768;
  const height={compact:320,medium:480,tall:640,screen:"min(800px,85vh)"}[props.height??"medium"];
  if(props.layout===undefined)return <>
    <BlockView block={{type:"image",ref:`sites/${siteId}/assets/${props.asset_id}`,alt:props.alt}} siteId={siteId}/>
    <Typography variant="h2">{props.title}</Typography>
    {props.text?<Typography>{props.text}</Typography>:null}
  </>;
  const media=<Box sx={{minWidth:0,minHeight:split && wide?height:280,position:overlay?"absolute":"relative",inset:overlay?0:undefined,
    order:mode==="split_reverse" && wide?2:0,
    clipPath:props.mask==="curve" && wide && split?"ellipse(98% 100% at 0% 50%)":undefined,
    borderRadius:props.mask==="rounded"?4:0,overflow:"hidden",
    "& picture":{display:"block",height:"100%"},"& img":{display:"block",width:"100%",height:"100%",minHeight:split&&wide?height:280,objectFit:"cover",objectPosition:props.image_position??"center"},
  }}><BlockView block={{type:"image",ref:`sites/${siteId}/assets/${props.asset_id}`,alt:props.alt}} siteId={siteId}/></Box>;
  return <Box ref={root} sx={{position:"relative",display:"grid",gridTemplateColumns:split&&wide?"minmax(0,1fr) minmax(0,1fr)":"minmax(0,1fr)",minHeight:overlay?height:undefined,isolation:"isolate",overflow:"hidden"}}>
    {media}
    {overlay?<Box aria-hidden="true" sx={{position:"absolute",inset:0,background:"linear-gradient(90deg,rgba(0,25,50,.88),rgba(0,25,50,.3))"}}/>:null}
    <Box sx={{position:"relative",zIndex:1,display:"flex",flexDirection:"column",justifyContent:"center",gap:3,p:{xs:3,md:5},color:overlay?"white":"inherit",minWidth:0}}>
      <Typography component="h2" sx={{fontSize:"clamp(1.75rem,4cqi,3.5rem)",fontWeight:750,lineHeight:1.12,m:0}}>{props.title}</Typography>
      {props.text?<Typography sx={{maxWidth:"60ch",lineHeight:1.7}}>{props.text}</Typography>:null}
      {props.actions?.length?<Box sx={{display:"flex",gap:1.5,flexWrap:"wrap"}}>{props.actions.map(action=><PresentationLink key={action.id} {...action} variant="solid"/>)}</Box>:null}
    </Box>
  </Box>;
}

export function ContentCarousel({items,label="Content carousel"}:{items:{id:string;content:ReactNode}[];label?:string}) {
  const [selected,setSelected]=useState(0);
  const panelId=useId();
  const position=Math.min(selected,Math.max(0,items.length-1));
  if(!items.length)return <Typography role="status">No slides are available.</Typography>;
  return <Box component="section" aria-label={label} aria-roledescription="carousel" sx={{display:"grid",gap:2,minWidth:0}}>
    <Box id={panelId} role="group" aria-roledescription="slide" aria-label={`${position+1} of ${items.length}`} key={items[position]!.id}>{items[position]!.content}</Box>
    {items.length>1?<Box sx={{display:"flex",gap:1,alignItems:"center",justifyContent:"center",flexWrap:"wrap"}}>
      <Button type="button" variant="outlined" aria-controls={panelId} disabled={position===0} onClick={()=>setSelected(position-1)} sx={{minHeight:44,"&:focus-visible":{outline:"3px solid currentColor",outlineOffset:3}}}>Previous slide</Button>
      <Typography aria-live="polite" aria-atomic="true">{position+1} of {items.length}</Typography>
      <Button type="button" variant="outlined" aria-controls={panelId} disabled={position===items.length-1} onClick={()=>setSelected(position+1)} sx={{minHeight:44,"&:focus-visible":{outline:"3px solid currentColor",outlineOffset:3}}}>Next slide</Button>
    </Box>:null}
  </Box>;
}
