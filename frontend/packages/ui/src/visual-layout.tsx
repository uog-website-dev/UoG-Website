"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Link from "@mui/material/Link";
import {
  LAYOUT_BREAKPOINT_WIDTHS,
  resolveSectionPresentation,
  resolveWidgetPresentation,
  validateVisualLayout,
} from "@uog/types";
import type { LayoutSection, VisualLayout, WidgetNode } from "@uog/types";
import { BlockView } from "./public-page";
import { ContentCarousel, decorativeStyle, HeroView, PresentationLink } from "./visual-presentation";
import {WidgetRuntimeProvider, SiteTitleWidget, SiteLogoWidget, LoopGridWidget, TaxonomyFilterWidget,
  PostTitleWidget, PostExcerptWidget, FeaturedImageWidget, ContactFormWidget, PostPreviewSelector, MenuWidget} from "./widget-runtime";

const tokenGap = {none:0,sm:1,md:2,lg:4} as const;
const focusRing = {"&:focus-visible":{outline:"3px solid",outlineColor:"primary.main",outlineOffset:2}} as const;

function presentationStyle(resolved:{align:string;tone:string;gap:"none"|"sm"|"md"|"lg"}) {
  return {
    textAlign:resolved.align === "center" ? "center" as const : resolved.align === "end" ? "end" as const : "start" as const,
    gap:tokenGap[resolved.gap],
    bgcolor:resolved.tone === "muted" ? "grey.100" : resolved.tone === "brand" ? "primary.light" : "transparent",
  };
}

function useLayoutViewportWidth(forced?: number) {
  const rootRef = useRef<HTMLDivElement|null>(null);
  const [width, setWidth] = useState(forced ?? LAYOUT_BREAKPOINT_WIDTHS.desktop);
  useLayoutEffect(() => {
    if (forced !== undefined) {
      setWidth(forced);
      return;
    }
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const measure = () => setWidth(root.clientWidth || LAYOUT_BREAKPOINT_WIDTHS.desktop);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [forced]);
  return { rootRef, width };
}

function SectionRow({row,siteId,pageTitle,width}:{row:LayoutSection;siteId:number|null;pageTitle:string;width:number}) {
  const resolved = resolveSectionPresentation(row.style, row.responsive, width);
  const columns = resolved.stack
    ? "minmax(0,1fr)"
    : row.ratios.map((ratio) => `minmax(0, ${ratio}fr)`).join(" ");
  return <Box
    component="section"
    data-node-id={row.id}
    data-resolved-breakpoint={resolved.breakpoint}
    data-resolved-gap={resolved.gap}
    data-resolved-stack={resolved.stack ? "true" : "false"}
    sx={{display:"grid",gridTemplateColumns:columns,...presentationStyle(resolved),...decorativeStyle(row.style)}}
  >
    {row.columns.map((column) => (
      <Box key={column.id} data-node-id={column.id} sx={{minWidth:0,display:"flex",flexDirection:"column",gap:2}}>
        {column.children.map((widget) => (
          <VisualWidget key={widget.id} widget={widget} siteId={siteId} pageTitle={pageTitle} viewportWidth={width}/>
        ))}
      </Box>
    ))}
  </Box>;
}

/** Shared Admin/portal rendering. Unvalidated or unsupported trees fail closed. */
export function VisualLayoutView({layout,siteId,pageTitle,pageId,preview=false,mediaBase,viewportWidth}:{layout:VisualLayout;siteId:number|null;pageTitle:string;pageId?:string;preview?:boolean;mediaBase?:string;viewportWidth?:number}) {
  const checked=validateVisualLayout(layout);
  const { rootRef, width } = useLayoutViewportWidth(viewportWidth);
  if(!checked.ok)return <Typography role="status">This page content is currently unavailable.</Typography>;
  if(checked.value.rows.length===0)return <Typography role="status" color="text.secondary">This page has no visual content yet.</Typography>;
  const postBindings=/"type":"(?:post_title|post_excerpt|featured_image)"/.test(JSON.stringify(layout));
  return <WidgetRuntimeProvider siteId={siteId} pageId={pageId} preview={preview} mediaBase={mediaBase}>
    {preview && postBindings?<PostPreviewSelector/>:null}
    <Box ref={rootRef} data-layout-version="1" data-viewport-width={width} sx={{display:"grid",gap:3,minWidth:0,overflowWrap:"anywhere",containerType:"inline-size",containerName:"visual-layout"}}>
      {checked.value.rows.map((row) => (
        <SectionRow key={row.id} row={row} siteId={siteId} pageTitle={pageTitle} width={width}/>
      ))}
    </Box>
  </WidgetRuntimeProvider>;
}

/** Horizontal tabs with roving tabindex and APG arrow-key navigation (WCAG 2.2 keyboard). */
function TabsWidget({items}:{items:Array<{id:string;title:string;text:string}>}) {
  const baseId=useId();
  const [selected,setSelected]=useState(items[0]?.id ?? "");
  const tabRefs=useRef(new Map<string,HTMLButtonElement>());
  const pendingFocus=useRef<string|null>(null);
  useEffect(()=>{
    const id=pendingFocus.current;
    if(!id)return;
    pendingFocus.current=null;
    tabRefs.current.get(id)?.focus();
  },[selected]);
  if(items.length===0)return <Typography role="status" color="text.secondary">No tabs are available.</Typography>;
  const active=items.find(item=>item.id===selected)??items[0]!;
  function activate(id:string,focus=false) {
    if(focus) pendingFocus.current=id;
    setSelected(id);
  }
  function onTabKeyDown(event:ReactKeyboardEvent<HTMLButtonElement>,itemId:string) {
    const index=items.findIndex(value=>value.id===itemId);
    if(index<0)return;
    const destinations:Record<string,number>={
      ArrowRight:(index+1)%items.length,
      ArrowLeft:(index-1+items.length)%items.length,
      Home:0,
      End:items.length-1,
    };
    const next=destinations[event.key];
    if(next===undefined)return;
    event.preventDefault();
    activate(items[next]!.id,true);
  }
  return <Box data-widget="tabs" sx={{minWidth:0,overflowWrap:"anywhere"}}>
    <Box role="tablist" aria-label="Tabs" aria-orientation="horizontal" sx={{display:"flex",gap:1,flexWrap:"wrap",mb:1}}>
      {items.map(item=>{
        const selectedTab=item.id===active.id;
        return <Box
          key={item.id}
          component="button"
          type="button"
          role="tab"
          id={`${baseId}-tab-${item.id}`}
          aria-selected={selectedTab}
          aria-controls={`${baseId}-panel-${item.id}`}
          tabIndex={selectedTab?0:-1}
          ref={(node:HTMLButtonElement|null)=>{
            if(node) tabRefs.current.set(item.id,node);
            else tabRefs.current.delete(item.id);
          }}
          onClick={()=>activate(item.id)}
          onKeyDown={event=>onTabKeyDown(event,item.id)}
          sx={{cursor:"pointer",font:"inherit",color:"text.primary",minHeight:44,minWidth:44,maxWidth:"100%",overflowWrap:"anywhere",fontWeight:selectedTab?700:500,border:0,borderBottom:"2px solid",borderColor:selectedTab?"primary.main":"transparent",bgcolor:"transparent",px:1.5,py:1,...focusRing}}
        >{item.title}</Box>;
      })}
    </Box>
    {items.map(item=>{
      const selectedTab=item.id===active.id;
      return <Box
        key={item.id}
        role="tabpanel"
        id={`${baseId}-panel-${item.id}`}
        aria-labelledby={`${baseId}-tab-${item.id}`}
        tabIndex={0}
        sx={{minWidth:0,overflowWrap:"anywhere",...focusRing}}
        hidden={!selectedTab}
      >{selectedTab?<Typography sx={{overflowWrap:"anywhere"}}>{item.text}</Typography>:null}</Box>;
    })}
  </Box>;
}

function AccordionWidget({items}:{items:Array<{id:string;title:string;text:string}>}) {
  if(items.length===0)return <Typography role="status" color="text.secondary">No accordion panels are available.</Typography>;
  return <Box data-widget="accordion" sx={{display:"grid",gap:1,minWidth:0,overflowWrap:"anywhere"}}>
    {items.map((item,index)=>(
      <Box key={item.id} component="details" data-panel-id={item.id} open={index===0} sx={{minWidth:0}}>
        <Box component="summary" sx={{cursor:"pointer",fontWeight:700,minHeight:44,py:1,overflowWrap:"anywhere",listStyle:"none","&::-webkit-details-marker":{display:"none"},...focusRing}}>{item.title}</Box>
        <Typography sx={{mt:1,overflowWrap:"anywhere"}}>{item.text}</Typography>
      </Box>
    ))}
  </Box>;
}

function VisualWidget({widget,siteId,pageTitle,viewportWidth}:{widget:WidgetNode;siteId:number|null;pageTitle:string;viewportWidth:number}):ReactNode {
  const resolved = resolveWidgetPresentation(widget.style, widget.responsive, viewportWidth);
  let body:ReactNode;
  switch(widget.type) {
    case "site_title":body=<SiteTitleWidget/>;break;
    case "site_logo":body=<SiteLogoWidget/>;break;
    case "menu":body=<MenuWidget menu_code={widget.props.menu_code}/>;break;
    case "loop_grid":body=<LoopGridWidget {...widget.props}/>;break;
    case "taxonomy_filter":body=<TaxonomyFilterWidget {...widget.props}/>;break;
    case "post_title":body=<PostTitleWidget/>;break;
    case "post_excerpt":body=<PostExcerptWidget/>;break;
    case "featured_image":body=<FeaturedImageWidget/>;break;
    case "contact_form":body=<ContactFormWidget {...widget.props}/>;break;
    case "headline":body=<BlockView block={{type:"heading",...widget.props}} siteId={siteId}/>;break;
    case "editor":body=<BlockView block={{type:"paragraph",html:widget.props.html}} siteId={siteId}/>;break;
    case "hero_image":body=<HeroView props={widget.props} siteId={siteId} width={viewportWidth}/>;break;
    case "image":body=<BlockView block={{type:"image",ref:`sites/${siteId}/assets/${widget.props.asset_id}`,alt:widget.props.alt}} siteId={siteId}/>;break;
    case "image_slider":case "image_grid":body=<BlockView block={{type:widget.type === "image_slider" ? "slider":"gallery",slides:widget.props.items,images:widget.props.items}} siteId={siteId}/>;break;
    case "button":body=<PresentationLink {...widget.props}/>;break;
    case "button_grid":case "social_media_buttons":body=<Box sx={{display:"flex",gap:2,flexWrap:"wrap"}}>{widget.props.items.map(item=><BlockView key={item.id} block={{type:"button",label:item.label,href:item.href}} siteId={siteId}/>)}</Box>;break;
    case "layout_slider":case "anything_carousel":body=<ContentCarousel items={widget.props.items.map(item=>({id:item.id,content:<Box sx={{display:"grid",gap:2}}>{item.children.map(child=><VisualWidget key={child.id} widget={child} siteId={siteId} pageTitle={pageTitle} viewportWidth={viewportWidth}/>)}</Box>}))}/>;break;
    case "simple_masonry":body=<Box data-widget="simple_masonry" sx={{columns:viewportWidth>=900?3:viewportWidth>=600?2:1,columnGap:2}}>{widget.props.items.map(item=><Box key={item.id} sx={{breakInside:"avoid",mb:2,display:"grid",gap:2}}>{item.children.map(child=><VisualWidget key={child.id} widget={child} siteId={siteId} pageTitle={pageTitle} viewportWidth={viewportWidth}/>)}</Box>)}</Box>;break;
    case "tabs":body=<TabsWidget items={widget.props.items}/>;break;
    case "accordion":body=<AccordionWidget items={widget.props.items}/>;break;
    case "call_to_action":case "author_box":body=<Box><Typography variant="h3">{widget.props.title}</Typography><Typography>{widget.props.text}</Typography>{widget.props.href && widget.props.label?<BlockView block={{type:"button",href:widget.props.href,label:widget.props.label}}/>:null}</Box>;break;
    case "features":body=<Box sx={{display:"grid",gap:2}}>{widget.props.items.map(item=><Box key={item.id}><Typography variant="h3">{item.title}</Typography><Typography>{item.text}</Typography></Box>)}</Box>;break;
    case "testimonials":body=<Box component="blockquote"><Typography>{widget.props.text}</Typography><Typography component="cite">{widget.props.attribution}</Typography></Box>;break;
    case "page_title":body=<Typography variant="h2">{pageTitle}</Typography>;break;
    case "alert":body=<Typography role="note">{widget.props.text}</Typography>;break;
    case "menu_anchor":body=<Box id={widget.props.anchor}/>;break;
    case "countdown":body=<Typography>{widget.props.label}: <time dateTime={widget.props.ends_at}>{widget.props.ends_at}</time></Typography>;break;
    case "video_player":body=<Link href={widget.props.provider === "youtube" ? `https://www.youtube.com/watch?v=${widget.props.video_id}` : `https://vimeo.com/${widget.props.video_id}`} rel="noopener noreferrer">{widget.props.title}</Link>;break;
    case "google_maps":body=<Link href={`https://www.google.com/maps?q=${widget.props.latitude},${widget.props.longitude}&z=${widget.props.zoom}`} rel="noopener noreferrer">{widget.props.title}</Link>;break;
    case "icon":body=<Typography>{widget.props.label}</Typography>;break;
    case "price_table":body=<Box><Typography variant="h3">{widget.props.title}</Typography><Typography>{widget.props.price}</Typography><ul>{widget.props.items.map(item=><li key={item.id}>{item.text}</li>)}</ul><BlockView block={{type:"button",label:widget.props.label,href:widget.props.href}}/></Box>;break;
    default:body=<Typography color="text.secondary" role="status" data-fallback="integration">This content is currently unavailable.</Typography>;
  }
  return <Box
    data-node-id={widget.id}
    data-widget-type={widget.type}
    data-resolved-breakpoint={resolved.breakpoint}
    data-resolved-gap={resolved.gap}
    sx={{minWidth:0,...presentationStyle(resolved),...decorativeStyle(widget.style)}}
  >{body}</Box>;
}
