"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import useMediaQuery from "@mui/material/useMediaQuery";
import CloseRounded from "@mui/icons-material/CloseRounded";
import AddRounded from "@mui/icons-material/AddRounded";
import PauseRounded from "@mui/icons-material/PauseRounded";
import PlayArrowRounded from "@mui/icons-material/PlayArrowRounded";
import Button from "@mui/material/Button";
import LandscapeOutlined from "@mui/icons-material/LandscapeOutlined";
import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded";
import ArrowOutwardRounded from "@mui/icons-material/ArrowOutwardRounded";
import ArrowForwardRounded from "@mui/icons-material/ArrowForwardRounded";
import type {Theme} from "@mui/material/styles";
import Typography from "@mui/material/Typography";
import type { LayoutStyle, WidgetPropsMap } from "@uog/types";
import { BlockView } from "./public-page";
import { safeMenuHref } from "./site-navigation";

const sizes = {
  sm:"clamp(1rem,2cqi,1.5rem)", md:"clamp(1.25rem,3cqi,2rem)",
  lg:"clamp(1.5rem,4cqi,3rem)", xl:"clamp(2rem,5cqi,4rem)", display:"clamp(2.25rem,6cqi,5rem)",
};

const HEX_COLOUR = /^#[0-9A-Fa-f]{6}$/u;
/** Approved custom colours are stored as #rrggbb and pass straight through. */
const customColour = (value: unknown): string | undefined =>
  typeof value === "string" && HEX_COLOUR.test(value) ? value : undefined;
/** Pick white or the dark brand ink for readable text on a custom panel colour. */
function readableText(hex: string): "#ffffff" | "#172536" {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance < 0.4 ? "#ffffff" : "#172536";
}

export function decorativeStyle(style:LayoutStyle={}) {
  const background=(theme:Theme)=>customColour(style.background) ?? ({none:'transparent',paper:theme.palette.background.paper,mist:theme.palette.action.hover,navy:theme.palette.primary.dark,blue:theme.palette.primary.main,gold:theme.palette.secondary.main,blue_gradient:`linear-gradient(120deg,${theme.palette.primary.main},${theme.palette.primary.light})`,navy_gradient:`linear-gradient(120deg,${theme.palette.primary.dark},${theme.palette.primary.main})`})[style.background??'none'];
  const height={natural:"auto",compact:200,medium:360,tall:520}[style.image_height??"natural"];
  return {
    ...(style.content_width?{width:"100%",maxWidth:{full:"100%",wide:1120,reading:880}[style.content_width],mx:"auto"}:{}),
    p:{none:0,sm:1.5,md:3,lg:5,xl:8}[style.padding??"none"],
    color:(theme:Theme)=>customColour(style.text_color) ?? ({default:"inherit",brand:theme.palette.primary.main,inverse:theme.palette.primary.contrastText,muted:theme.palette.text.secondary})[style.text_color??"default"],
    ...(style.background ? {background} : {}),
    borderRadius:{none:0,sm:1,md:2,lg:4,pill:12}[style.radius??"none"],
    border:style.border && style.border!=="none"?"1px solid":undefined,
    borderColor:style.border==="brand"?"primary.main":"divider",
    boxShadow:{none:0,sm:1,md:3,lg:6}[style.shadow??"none"],
    ...(style.text_size ? {"& h2,& h3,& h4":{fontSize:sizes[style.text_size],lineHeight:1.15}} : {}),
    ...(style.image_fit || style.image_height || style.image_position ? {
      "& picture":{display:"block"},
      "& img":{display:"block",width:"100%",height,objectFit:style.image_fit==="contain"?"contain":"cover",objectPosition:style.image_position??"center"},
    } : {}),
  };
}

export function PresentationLink({href,label,variant="text",inverse=false,showArrow=false}:{href:string;label:string;variant?:"text"|"solid"|"outline";inverse?:boolean;showArrow?:boolean}) {
  const safe=safeMenuHref(href);
  if(!safe)return <Typography component="span">{label}</Typography>;
  return <Button component="a" href={safe} variant={variant==="solid"?"contained":variant==="outline"?"outlined":"text"} endIcon={showArrow?<ArrowOutwardRounded sx={{fontSize:18}}/>:undefined}
    sx={{...(inverse?{bgcolor:variant==="solid"?"white":"transparent",color:variant==="solid"?"primary.main":"white",borderColor:"white","&:hover":{bgcolor:variant==="solid"?"grey.100":"rgba(255,255,255,.12)",borderColor:"white"}}:{}),minHeight:44,maxWidth:"100%",overflowWrap:"anywhere",textAlign:"inherit","&:focus-visible":{outline:"3px solid currentColor",outlineOffset:3}}}>{label}</Button>;
}

export function HeroView({props,siteId,width,demoteH1=false}:{props:WidgetPropsMap["hero_image"];siteId:number|null;width:number;demoteH1?:boolean}) {
  const [closedCards,setClosedCards]=useState<Set<string>>(()=>new Set());
  const cardScope=useId();
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
  const hasCards=Boolean(props.items?.length);
  const mode=hasCards?"overlay":props.layout??"stacked";
  const split=mode==="split" || mode==="split_reverse";
  const overlay=mode==="overlay";
  const wide=available>=(hasCards?1100:768);
  const height={compact:320,medium:480,tall:640,screen:"min(800px,85vh)"}[props.height??"medium"];
  const explicitPresentation=[props.pattern,props.panel_tone,props.curve_border,props.heading_level,props.heading_size,props.heading_color,props.heading_weight,props.heading_case,props.text_align,props.body_size,props.actions,props.items].some(value=>value!==undefined);
  if(props.layout===undefined&&!explicitPresentation)return <>
    <BlockView block={{type:"image",ref:`sites/${siteId}/assets/${props.asset_id}`,alt:props.alt}} siteId={siteId}/>
    <Typography variant="h2">{props.title}</Typography>
    {props.text?<Typography>{props.text}</Typography>:null}
  </>;
  const ratio=props.media_ratio??50;
  // The Page title owns the H1 when it is visible, so a hero that requests H1
  // is demoted to H2 instead of publishing a second main heading.
  const headingComponent=props.heading_level===3?"h3":props.heading_level===4?"h4":props.heading_level===1&&!demoteH1?"h1":"h2";
  const contentHeight=props.height==="compact"?320:props.height==="tall"?440:360;
  const pattern=props.pattern??(split?"heritage":"none");
  const tone=props.panel_tone??"inherit";
  const toneHex=customColour(props.panel_tone);
  const toneText=toneHex?readableText(toneHex):undefined;
  const panelBackground={background:tone==="brand_gradient"?"linear-gradient(135deg,var(--mui-palette-primary-main,#075985),var(--mui-palette-primary-dark,#003459))":tone==="dark_gradient"?"linear-gradient(135deg,#082f49,#111827)":undefined,bgcolor:toneHex ?? (tone==="mist"?"#edf3f7":tone==="gold"?"#f8edce":tone==="brand"?"primary.main":tone==="dark"?"primary.dark":tone==="light"?"background.paper":undefined)};
  const heritagePattern="url(\"data:image/svg+xml,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><path d="M8 0v24h32v16H24v32H0M56 0v16h24v32h16M96 72H64V56H48v32h40v8M8 40h8v16H8" fill="none" stroke="#76a6bd" stroke-width="9"/></svg>')+"\")";
  const inverse=overlay||["brand","dark","brand_gradient","dark_gradient"].includes(tone)||toneText==="#ffffff";
  const curved=props.mask==="curve"&&wide&&split;
  const curve=mode==="split_reverse"?"ellipse(98% 100% at 100% 50%)":"ellipse(98% 100% at 0% 50%)";
  const edge=props.curve_border??"none",edgeWidth=props.curve_border_width??8;
  const patterns:Record<string,string>={dots:"radial-gradient(currentColor 1.5px,transparent 1.5px)",diagonal:"repeating-linear-gradient(135deg,currentColor 0 1px,transparent 1px 18px)",waves:"repeating-radial-gradient(ellipse at 0 0,transparent 0 15px,currentColor 16px 17px,transparent 18px 32px)",diamonds:"repeating-linear-gradient(45deg,currentColor 0 1px,transparent 1px 28px),repeating-linear-gradient(-45deg,currentColor 0 1px,transparent 1px 28px)"};
  const patternImage=patterns[pattern]??(pattern==="heritage"?heritagePattern:"linear-gradient(currentColor 1px,transparent 1px),linear-gradient(90deg,currentColor 1px,transparent 1px)");
  const media=<Box sx={{minWidth:0,minHeight:0,height:"100%",position:"relative",
    order:mode==="split_reverse" && wide?2:0,
    clipPath:curved?curve:undefined,
    bgcolor:customColour(edge) ?? (edge==="white"?"white":edge==="gold"?"#d8ad45":"primary.main"),
    ...(curved&&edge!=="none"?{"& > *":{clipPath:curve,transform:`translateX(${mode==="split_reverse"?edgeWidth:-edgeWidth}px)`}}:{}),
    borderRadius:props.mask==="rounded"?4:0,overflow:"hidden",
    "& > *":{...(curved&&edge!=="none"?{clipPath:curve,transform:`translateX(${mode==="split_reverse"?edgeWidth:-edgeWidth}px)`}:{}),position:"absolute",inset:0,width:"100%",height:"100%"},"& figure,& picture":{display:"block",m:0,height:"100%",width:"100%"},"& img":{display:"block",width:"100%",height:"100%",maxHeight:"none",objectFit:"cover",objectPosition:props.image_position??"center"},
  }}>{siteId===null?<Box role="img" aria-label="Site image preview placeholder" sx={{minHeight:280,height:'100%',display:'grid',alignContent:'center',justifyItems:'center',gap:2,p:3,bgcolor:'action.hover'}}><LandscapeOutlined sx={{fontSize:100,opacity:.5}}/><Typography>{props.alt}</Typography></Box>:<BlockView block={{type:"image",ref:`sites/${siteId}/assets/${props.asset_id}`,alt:props.alt}} siteId={siteId}/>}</Box>;
  const card=(item:NonNullable<typeof props.items>[number])=><Box key={item.id} sx={{position:"relative",minWidth:0,alignSelf:"center"}}>
    <Button type="button" aria-label={`${closedCards.has(item.id)?"Show":"Hide"} ${item.title}`} aria-expanded={!closedCards.has(item.id)} aria-controls={closedCards.has(item.id)?undefined:`${cardScope}-${item.id}`} onClick={()=>setClosedCards(current=>{const next=new Set(current);if(next.has(item.id))next.delete(item.id);else next.add(item.id);return next;})} startIcon={closedCards.has(item.id)?<AddRounded/>:<CloseRounded/>}
      sx={{position:closedCards.has(item.id)?"relative":"absolute",right:closedCards.has(item.id)?undefined:8,top:closedCards.has(item.id)?undefined:8,zIndex:2,"& .MuiButton-startIcon":{mr:closedCards.has(item.id)?1:0,ml:0},minWidth:44,minHeight:44,bgcolor:"background.paper",color:"text.primary",borderRadius:6,boxShadow:2,"&:hover":{bgcolor:"grey.100"},"&:focus-visible":{outline:"3px solid",outlineColor:"primary.main",outlineOffset:3}}}>{closedCards.has(item.id)?item.title:null}</Button>
    {!closedCards.has(item.id)?<Box component="article" id={`${cardScope}-${item.id}`} data-hero-info-card={item.id} sx={{bgcolor:"background.paper",color:"text.primary",borderRadius:2,overflow:"hidden",boxShadow:4,minWidth:0,textAlign:"left"}}>
    <Box sx={{height:{xs:160,md:180},position:"relative","& figure,& picture":{m:0,height:"100%",display:"block"},"& img":{display:"block",width:"100%",height:"100%",objectFit:"cover"}}}>{siteId===null?<Box role="img" aria-label={item.alt} sx={{height:"100%",bgcolor:"action.hover"}}/>:<BlockView block={{type:"image",ref:`sites/${siteId}/assets/${item.asset_id}`,alt:item.alt}} siteId={siteId}/>}</Box>
    <Box sx={{p:2.5,display:"grid",gap:1.5}}>{item.eyebrow?<Typography variant="body2" color="primary.main" fontWeight={600}>{item.eyebrow}</Typography>:null}<Typography component="h3" variant="h5" fontWeight={700}>{item.title}</Typography><Typography sx={{lineHeight:1.6,overflowWrap:"anywhere"}}>{item.text}</Typography><Box><PresentationLink href={item.href} label={item.label} showArrow/></Box></Box>
  </Box>:null}
  </Box>;
  return <Box ref={root} data-hero-frame data-hero-height={props.height??"medium"} sx={{...(split?panelBackground:{}),position:"relative",display:"grid",height:overlay||split&&wide?height:280+contentHeight,gridTemplateRows:overlay||split&&wide?"minmax(0,1fr)":`280px minmax(0,${contentHeight}px)`,gridTemplateColumns:split&&wide?`minmax(0,${mode==="split_reverse"?100-ratio:ratio}fr) minmax(0,${mode==="split_reverse"?ratio:100-ratio}fr)`:"minmax(0,1fr)",isolation:"isolate",overflow:"hidden"}}>
    {overlay?<Box sx={{position:"absolute",inset:0}}>{media}</Box>:media}
    {overlay?<Box aria-hidden="true" sx={{position:"absolute",inset:0,background:"linear-gradient(90deg,rgba(0,25,50,.88),rgba(0,25,50,.3))"}}/>:null}
    <Box tabIndex={0} role="region" aria-label="Slide text and actions" sx={{"&:focus-visible":{outline:"3px solid",outlineColor:"secondary.main",outlineOffset:-4},position:"relative",zIndex:1,display:"flex",flexDirection:"column",justifyContent:"safe center",gap:3,p:{xs:3,md:5},pb:{xs:3,md:8},overflowY:"auto",textAlign:props.text_align??"left",alignItems:props.text_align==="center"?"center":props.text_align==="right"?"flex-end":undefined,color:toneText ?? (inverse?"white":["light","mist","gold"].includes(tone)?"#172536":"inherit"),...(split||hasCards?{}:panelBackground),minWidth:0,minHeight:0}}>
      {pattern!=="none"?<Box aria-hidden="true" data-hero-pattern={pattern} sx={{position:"absolute",inset:0,pointerEvents:"none",backgroundImage:patternImage,backgroundSize:pattern==="grid"?"36px 36px":pattern==="dots"?"20px 20px":"88px 88px",opacity:pattern==="heritage"?.22:.075,maskImage:"linear-gradient(110deg,transparent 10%,black 100%)",zIndex:-1}}/>:null}
      {hasCards&&props.cards_label?<Typography sx={{alignSelf:"flex-start",bgcolor:"white",color:"#172536",px:2,py:1,fontWeight:700}}>{props.cards_label}</Typography>:null}
      <Box sx={hasCards?{display:"grid",gridTemplateColumns:wide?"minmax(0,1fr) minmax(0,1.3fr) minmax(0,1fr)":"minmax(0,1fr)",gap:3,alignItems:"center",width:"100%"}:undefined}>
      {hasCards&&wide?card(props.items![0]!):null}
      <Box sx={{display:"grid",gap:3,minWidth:0,textAlign:hasCards?"center":props.text_align}}>
      <Typography component={headingComponent} sx={{fontSize:props.heading_size?sizes[props.heading_size]:"clamp(1.75rem,4cqi,3.5rem)",fontWeight:{regular:400,medium:500,bold:700,heavy:800}[props.heading_weight??"bold"],color:customColour(props.heading_color) ?? (props.heading_color==="white"?"white":props.heading_color==="gold"?"#d8ad45":props.heading_color==="brand"?"primary.main":props.heading_color==="dark"?"#172536":"inherit"),textTransform:props.heading_case==="uppercase"?"uppercase":"none",lineHeight:1.12,m:0,overflowWrap:"anywhere"}}>{props.title}</Typography>
      {props.text?<Typography sx={{maxWidth:"60ch",fontSize:{sm:".95rem",md:"1.1rem",lg:"1.3rem"}[props.body_size??"md"],lineHeight:1.7}}>{props.text}</Typography>:null}
      {props.actions?.length?<Box sx={{display:"flex",gap:1.5,flexWrap:"wrap"}}>{props.actions.map((action,index)=><PresentationLink key={action.id} {...action} inverse={inverse} showArrow variant={index===0?"solid":"outline"}/>)}</Box>:null}
      </Box>
      {hasCards&&!wide?card(props.items![0]!):null}
      {hasCards&&props.items![1]?card(props.items![1]):null}
      </Box>
    </Box>
  </Box>;
}

export function ContentCarousel({items,label="Content carousel",navigation="standard",autoplaySeconds=0,frameHeight,frameStacked=false}:{items:{id:string;content:ReactNode;thumbnail?:ReactNode}[];label?:string;navigation?:"standard"|"overlay"|"thumbnails";autoplaySeconds?:number;frameHeight?:"compact"|"medium"|"tall"|"screen";frameStacked?:boolean}) {
  const [selected,setSelected]=useState(0),[paused,setPaused]=useState(false),[hovered,setHovered]=useState(false),[focused,setFocused]=useState(false),[hidden,setHidden]=useState(false);
  const reducedMotion=useMediaQuery("(prefers-reduced-motion: reduce)",{noSsr:true});
  const panelId=useId();
  const carouselRoot=useRef<HTMLDivElement>(null);const [frameWidth,setFrameWidth]=useState(1024);
  useLayoutEffect(()=>{const root=carouselRoot.current;if(!root)return;const measure=()=>setFrameWidth(root.clientWidth||1024);measure();const observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(measure):null;observer?.observe(root);return()=>observer?.disconnect();},[]);
  const fixedHeight=frameHeight?(frameStacked&&frameWidth<768?280+(frameHeight==="compact"?320:frameHeight==="tall"?440:360):({compact:320,medium:480,tall:640,screen:"min(800px,85vh)"}[frameHeight])):undefined;
  const identity=items.map(item=>item.id).join("|");
  useEffect(()=>{setSelected(0);},[identity]);
  useEffect(()=>{const change=()=>setHidden(document.hidden);change();document.addEventListener("visibilitychange",change);return()=>document.removeEventListener("visibilitychange",change);},[]);
  const interval=[5,8,10].includes(autoplaySeconds)?autoplaySeconds:0;
  const running=interval>0&&items.length>1&&!paused&&!hovered&&!focused&&!hidden&&!reducedMotion;
  useEffect(()=>{if(!running)return;const timer=setInterval(()=>setSelected(index=>(index+1)%items.length),interval*1000);return()=>clearInterval(timer);},[running,interval,items.length]);
  const position=Math.min(selected,Math.max(0,items.length-1));
  if(!items.length)return <Typography role="status">No slides are available.</Typography>;
  const overlay=navigation==="overlay";
  const controlStyle={minWidth:44,minHeight:44,color:overlay?"white":undefined,borderColor:overlay?"rgba(255,255,255,.65)":undefined,"&:focus-visible":{outline:"3px solid currentColor",outlineOffset:2}};
  return <Box ref={carouselRoot} component="section" aria-label={label} aria-roledescription="carousel" onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onFocusCapture={()=>setFocused(true)} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setFocused(false);}} sx={{display:"grid",gap:2,minWidth:0,position:"relative"}}>
    <Box tabIndex={fixedHeight?0:undefined} sx={{height:fixedHeight,minHeight:0,overflowY:fixedHeight?"auto":undefined,overflowX:"hidden","& > *":fixedHeight?{minHeight:"100%"}:undefined,"@keyframes slideAppear":{from:{opacity:.4},to:{opacity:1}},"@media (prefers-reduced-motion: no-preference)":{animation:"slideAppear 220ms ease-out"}}} id={panelId} role="group" aria-roledescription="slide" aria-label={`${position+1} of ${items.length}`} key={items[position]!.id}>{items[position]!.content}</Box>
    {items.length>1?<Box sx={{display:"flex",gap:1,alignItems:"center",justifyContent:"center",flexWrap:"wrap",order:navigation==="thumbnails"?-1:undefined,...(overlay?{position:{xs:"static",md:"absolute"},bottom:12,right:12,left:{xs:12,md:"auto"},zIndex:2,bgcolor:"rgba(0,25,50,.78)",color:"white",p:0.5,borderRadius:8}:{} )}}>
      <Button type="button" variant="text" aria-controls={panelId} disabled={!interval&&position===0} onClick={()=>setSelected((position-1+items.length)%items.length)} sx={controlStyle} aria-label="Previous slide"><ArrowBackRounded/></Button>
      <Box sx={{display:"flex",gap:1,flexWrap:"wrap",justifyContent:"center"}}>{items.map((item,index)=><Button key={item.id} type="button" aria-label={`Go to slide ${index+1}`} aria-current={position===index?"true":undefined} aria-controls={panelId} onClick={()=>{setSelected(index);setPaused(true);}} sx={{...controlStyle,minWidth:navigation==="thumbnails"?64:44,p:navigation==="thumbnails"?0.5:0,border:navigation==="thumbnails"?2:0,borderColor:position===index?"primary.main":"transparent",borderRadius:navigation==="thumbnails"?2:8}}>
       {navigation==="thumbnails"&&item.thumbnail?<Box aria-hidden sx={{width:56,height:56,overflow:"hidden","& picture":{display:"block",height:"100%"},"& img":{width:"100%",height:56,objectFit:"contain"}}}>{item.thumbnail}</Box>:<Box aria-hidden sx={{width:position===index?22:9,height:9,borderRadius:8,bgcolor:overlay?"white":position===index?"primary.main":"action.disabled",opacity:position===index?1:.55}}/>}
      </Button>)}</Box>
      <Typography sx={{position:"absolute",width:1,height:1,p:0,m:-1,overflow:"hidden",clipPath:"inset(50%)",whiteSpace:"nowrap"}} aria-live={running?"off":"polite"} aria-atomic="true">{position+1} of {items.length}</Typography>
      <Button type="button" variant="text" aria-controls={panelId} disabled={!interval&&position===items.length-1} onClick={()=>setSelected((position+1)%items.length)} sx={controlStyle} aria-label="Next slide"><ArrowForwardRounded/></Button>
      {interval>0?<Button type="button" aria-label={paused?"Play carousel":"Pause carousel"} disabled={reducedMotion} onClick={()=>setPaused(!paused)} sx={{...controlStyle,position:"absolute",width:1,height:1,minWidth:0,minHeight:0,p:0,m:-1,overflow:"hidden",clipPath:"inset(50%)","&:focus-visible":{position:"relative",width:44,height:44,m:0,clipPath:"none",outline:"3px solid currentColor"}}}>{paused?<PlayArrowRounded/>:<PauseRounded/>}</Button>:null}
    </Box>:null}
  </Box>;
}
