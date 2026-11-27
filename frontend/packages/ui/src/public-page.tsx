"use client";

/**
 * Published Page body for the Site the backend already resolved.
 *
 * Callers pass one document from `GET /api/v1/site-context/homepage/` or a
 * public page route. Drafts and a disabled PAGES module (404) render nothing.
 * Paragraph HTML renders through `RichText`, which keeps the editor's inline
 * formatting and safe links. Script, event handlers and javascript: targets
 * never become markup.
 */
import { createContext, useContext, useEffect, useState } from "react";
import { validateVisualLayout, MAX_MENU_DEPTH } from "@uog/types";
import type { VisualLayout } from "@uog/types";
import { VisualLayoutView } from "./visual-layout";
import { RichText } from "./rich-text";
import { resolvePageHeading } from "./page-heading";
import { PAGE_CONTENT_WIDTHS, resolvePageWidth, withSafePageWidth } from "./page-width";
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { usePublicSiteBranding } from "./site-branding";

/** Inline styles so MUI Typography sx/variant cannot override the clip box. */
const SR_ONLY_TITLE_STYLE = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;

import { publicFetchInit, publicLogoSource } from "./public-site";
import type {PublicMenuNode} from "./site-navigation";
import { menusFromResponse, SiteNavigation, safeMenuHref } from "./site-navigation";
import { ContentBanner, crumbsFromPagePath } from "./content-banner";
import {
  bannerStyleFromUnknown,
  resolveContentBannerStyle,
  type PublicTitleBannerStyle,
} from "./content-banner-model";
const PrivateMediaBase = createContext<string | null>(null);
const focusRing = {"&:focus-visible":{outline:"3px solid",outlineColor:"primary.main",outlineOffset:2}} as const;

export interface PublicBlock {
  type: string;
  text?: string;
  html?: string;
  level?: number;
  label?: string;
  href?: string;
  alt?: string;
  ref?: string;
  id?: string;
  slides?: PublicMediaItem[];
  images?: PublicMediaItem[];
  items?: string[];
  style?: string;
  heading?: string;
  children?: PublicBlock[];
}

export interface PublicMediaItem { id: string; asset_id: string; alt: string; caption?: string }

export interface SidebarLink { label: string; href: string; children: SidebarLink[] }
export interface SidebarSnapshot {
  id: string; site: number; version: number; name: string;
  components: { id: string; type: "menu" | "related_pages" | "recent_posts"; menu_id?: string; page_ids?: string[]; limit?: number; title?: string; state?: "ready" | "empty" | "unavailable"; items: SidebarLink[] }[];
}

/** Independently validate frozen navigation before using it on either surface. */
export function sidebarFromResponse(value: unknown, site: number | null, id: string | null): SidebarSnapshot | undefined {
  if (!value || typeof value !== "object" || !id || site === null) return undefined;
  const row = value as SidebarSnapshot;
  if (row.id !== id || row.site !== site || typeof row.name !== "string" || row.name.length > 120
      || !Number.isInteger(row.version) || row.version < 1 || !Array.isArray(row.components) || row.components.length > 12) return undefined;
  let count = 0;
  function validLinks(links: SidebarLink[], depth: number): boolean {
    return depth <= MAX_MENU_DEPTH && Array.isArray(links) && links.every(link => {
      if (++count > 2000 || !link || typeof link.label !== "string" || link.label.length > 255
          || typeof link.href !== "string" || link.href.length > 2048 || !safeMenuHref(link.href)) return false;
      return link.children?.length ? validLinks(link.children, depth + 1) : Array.isArray(link.children);
    });
  }
  const ids = new Set<string>();
  return row.components.every(component => {
    if (!component || !["menu", "related_pages", "recent_posts"].includes(component.type) || typeof component.id !== "string" || (component.title !== undefined && (typeof component.title !== "string" || component.title.length > 255)) || ids.has(component.id)) return false;
    if (component.state !== undefined && !["ready", "empty", "unavailable"].includes(component.state)) return false;
    if (component.type !== "menu" && (typeof component.title !== "string" || !component.title.trim())) return false;
    ids.add(component.id);
    return validLinks(component.items, 1);
  }) ? row : undefined;
}

function SidebarLinks({ items }: { items: SidebarLink[] }) {
  return <Box component="ul" sx={{ pl: 2, m: 0, display: "grid", gap: 1.25 }}>
    {items.map((item, index) => <Box component="li" key={`${index}:${item.href}`}>
      <Link href={item.href}>{item.label}</Link>
      {item.children.length ? <SidebarLinks items={item.children} /> : null}
    </Box>)}
  </Box>;
}

export interface PublicPageDocument {
  id?: string;
  title: string;
  layout?: string;
  sidebar_id?: string | null;
  sidebar_snapshot?: SidebarSnapshot;
  locale?: string;
  is_homepage?: boolean;
  path: string;
  site: number | null;
  blocks: PublicBlock[];
  visual_layout?: VisualLayout;
  layout_unavailable?: boolean;
  title_banner?: PublicTitleBannerStyle | null;
  seo: { title: string; description: string };
}

interface TextPart {
  type: "text";
  value: string;
}

interface LinkPart {
  type: "link";
  href: string;
  label: string;
}

/** Turn a public Page response into one document. 404 and drafts become null. */
export function pageFromResponse(status: number, body: unknown): PublicPageDocument | null {
  if (status !== 200 || body == null || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const row = body as { title?: unknown; path?: unknown; status?: unknown; blocks?: unknown; site?: unknown; metadata?: unknown; seo?: unknown; layout?: unknown; sidebar_id?: unknown; sidebar_snapshot?: unknown; locale?: unknown; is_homepage?: unknown };
  if (row.status != null && row.status !== "PUBLISHED") return null;
  if (typeof row.title !== "string" || !row.title.trim()) return null;
  const path = typeof row.path === "string" && row.path.startsWith("/") ? row.path : "/";
  const seo = row.seo != null && typeof row.seo === "object" ? row.seo as { meta_title?: unknown; meta_description?: unknown } : {};
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string,unknown> : {};
  const visual = Object.hasOwn(metadata,"visual_layout") ? validateVisualLayout(withSafePageWidth(metadata.visual_layout)) : null;
  const bannerOverride = titleBannerFromMetadata(metadata);
  return {
    ...(typeof (body as {id?:unknown}).id==="string" ? {id:(body as {id:string}).id}:{}),
    ...(visual ? visual.ok ? {visual_layout:visual.value} : {layout_unavailable:true} : {}),
    title: row.title.trim(),
    layout: typeof row.layout === "string" ? row.layout : "FULL_WIDTH",
    sidebar_id: typeof row.sidebar_id === "string" ? row.sidebar_id : null,
    sidebar_snapshot: sidebarFromResponse(row.sidebar_snapshot, typeof row.site === "number" ? row.site : null, typeof row.sidebar_id === "string" ? row.sidebar_id : null),
    locale: typeof row.locale === "string" ? row.locale : undefined,
    is_homepage: row.is_homepage === true,
    path,
    site: typeof row.site === "number" ? row.site : null,
    blocks: normalizeBlocks(row.blocks),
    ...(bannerOverride ? { title_banner: bannerOverride } : {}),
    seo: {
      title: plainSeo(seo.meta_title, 120),
      description: plainSeo(seo.meta_description, 300),
    },
  };
}

function titleBannerFromMetadata(metadata: Record<string, unknown>): PublicTitleBannerStyle | null {
  if (!Object.hasOwn(metadata, "title_banner")) return null;
  const value = metadata.title_banner;
  if (value == null) return null;
  if (typeof value === "object" && !Array.isArray(value) && (value as { use_global?: unknown }).use_global === true) {
    return null;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const row = value as Record<string, unknown>;
    if (Object.keys(row).every((key) => key === "use_global" || key === "enabled") && typeof row.enabled === "boolean") {
      return { ...resolveContentBannerStyle(undefined, "page"), enabled: row.enabled };
    }
  }
  const parsed = bannerStyleFromUnknown(value);
  if (!parsed) return null;
  // Admin stores image_ref; public rendering uses the media route when present.
  const ref = typeof (value as { image_ref?: unknown }).image_ref === "string"
    ? (value as { image_ref: string }).image_ref
    : null;
  if (parsed.background_type === "image" && ref) {
    const assetId = ref.replace(/^sites\/\d+\/assets\//, "");
    if (/^[0-9a-f-]{36}$/i.test(assetId) || /^[0-9a-f]{32}$/i.test(assetId)) {
      const uuid = assetId.includes("-")
        ? assetId
        : assetId.replace(/^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/i, "$1-$2-$3-$4-$5");
      return { ...parsed, image_url: `/api/v1/site-context/media/${uuid}/?variant=display` };
    }
  }
  return parsed;
}

function normalizeMediaItems(value: unknown): PublicMediaItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item.id === "string" && typeof item.asset_id === "string" && typeof item.alt === "string").map((item) => ({ id:item.id, asset_id:item.asset_id, alt:item.alt, caption:typeof item.caption === "string" ? item.caption : undefined }));
}

function plainSeo(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return stripTags(value).replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeBlocks(value: unknown): PublicBlock[] {
  if (!Array.isArray(value)) return [];
  const blocks: PublicBlock[] = [];
  for (const entry of value) {
    if (entry == null || typeof entry !== "object") continue;
    const row = entry as PublicBlock;
    if (typeof row.type !== "string") continue;
    blocks.push({
      type: row.type,
      text: typeof row.text === "string" ? row.text : undefined,
      html: typeof row.html === "string" ? row.html : undefined,
      level: typeof row.level === "number" ? row.level : undefined,
      label: typeof row.label === "string" ? row.label : undefined,
      href: typeof row.href === "string" ? row.href : undefined,
      alt: typeof row.alt === "string" ? row.alt : undefined,
      id: typeof row.id === "string" ? row.id : undefined,
      slides: normalizeMediaItems(row.slides),
      images: normalizeMediaItems(row.images),
      ref: typeof row.ref === "string" ? row.ref : undefined,
      items: Array.isArray(row.items) ? row.items.filter((item) => typeof item === "string") : undefined,
      style: typeof row.style === "string" ? row.style : undefined,
      heading: typeof row.heading === "string" ? row.heading : undefined,
      children: normalizeBlocks(row.children),
    });
  }
  return blocks;
}

function stripTags(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

/** Split paragraph HTML into text and links whose targets pass the menu policy. */
export function paragraphParts(html: string): Array<TextPart | LinkPart> {
  const source = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  const parts: Array<TextPart | LinkPart> = [];
  const pattern = /<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    pushText(parts, source.slice(cursor, index));
    const href = safeMenuHref(match[1] ?? "");
    const label = stripTags(match[2] ?? "").trim();
    if (label && href) parts.push({ type: "link", href, label });
    else if (label) parts.push({ type: "text", value: label });
    cursor = index + match[0].length;
  }
  pushText(parts, source.slice(cursor));
  return parts;
}

function pushText(parts: Array<TextPart | LinkPart>, raw: string) {
  const value = stripTags(raw).replace(/\s+/g, " ").trim();
  if (value) parts.push({ type: "text", value });
}

function BlockList({ blocks, siteId }: { blocks: PublicBlock[]; siteId?: number | null }) {
  return (
    <>
      {blocks.map((block, index) => (
        <BlockView key={`${siteId}-${block.id ?? `${block.type}-${index}`}`} block={block} siteId={siteId} />
      ))}
    </>
  );
}

export function BlockView({ block, siteId }: { block: PublicBlock; siteId?: number | null }) {
  if (block.type === "heading" && block.text) {
    const level = block.level === 2 || block.level === 3 || block.level === 4 ? block.level : 2;
    return (
      <Typography variant={`h${level}` as "h2"} component={`h${level}` as "h2"} sx={{ mt: 2, fontSize: {2:"clamp(1.65rem,3.2cqi,2.65rem)",3:"clamp(1.3rem,2.5cqi,1.85rem)",4:"1.25rem"}[level], lineHeight:1.2, letterSpacing:"-.025em" }}>
        {block.text}
      </Typography>
    );
  }
  if (block.type === "paragraph" && block.html) {
    // Rich text keeps the editor's inline formatting, links and quotes.
    return <RichText html={block.html} />;
  }
  if (block.type === "button" && block.label) {
    const href = block.href ? safeMenuHref(block.href) : null;
    if (!href) {
      return <Typography component="p">{block.label}</Typography>;
    }
    return (
      <Link
        href={href}
        rel="noopener noreferrer"
        sx={{
          fontWeight: 700,
          display: "inline-flex",
          alignItems: "center",
          minHeight: 44,
          minWidth: 44,
          px: 0.5,
          overflowWrap: "anywhere",
          "&:focus-visible": { outline: "3px solid", outlineColor: "primary.main", outlineOffset: 2 },
        }}
      >
        {block.label}
      </Link>
    );
  }
  if (block.type === "list" && block.items && block.items.length > 0) {
    const Tag = block.style === "ordered" ? "ol" : "ul";
    return (
      <Box component={Tag} sx={{ pl: 3 }}>
        {block.items.map((item) => (
          <Typography key={item} component="li">{item}</Typography>
        ))}
      </Box>
    );
  }
  if (block.type === "slider" || block.type === "gallery") return <MediaCollection block={block} siteId={siteId} />;
  if (block.type === "image") {
    return <PublishedImage key={`${siteId}-${block.ref}`} block={block} siteId={siteId} />;
  }
  if (block.type === "section") {
    return (
      <Box component="section" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {block.heading ? <Typography variant="h2" component="h2">{block.heading}</Typography> : null}
        <BlockList blocks={block.children ?? []} siteId={siteId} />
      </Box>
    );
  }
  return null;
}

function MediaCollection({block,siteId}:{block:PublicBlock;siteId?:number|null}) {
  const [position,setPosition]=useState(0);
  const items=block.type==="slider" ? block.slides ?? [] : block.images ?? [];
  const current=Math.min(position,Math.max(0,items.length-1));
  const shown=block.type==="slider" ? items.slice(current,current+1) : items;
  return <Box component="section" aria-label={block.type==="slider" ? "Image slider" : "Image gallery"} aria-roledescription={block.type==="slider"?"carousel":undefined} sx={{"& figure img":{display:"block",width:"100%",maxHeight:block.type==="slider"?560:360,objectFit:"cover",borderRadius:2},"& figcaption":{mt:1,color:"text.secondary",fontSize:".9rem"},display:"grid",gridTemplateColumns:block.type==="gallery"?"repeat(auto-fit,minmax(min(100%,240px),1fr))":"minmax(0,1fr)",gap:2,minWidth:0,overflowWrap:"anywhere"}}>
    {shown.map((item) => <Box component="figure" key={`${siteId}-${item.id}-${item.asset_id}`} sx={{m:0}}>
      <PublishedImage block={{type:"image",ref:`sites/${siteId}/assets/${item.asset_id}`,alt:item.alt}} siteId={siteId} />
      {item.caption ? <Typography component="figcaption">{item.caption}</Typography> : null}
    </Box>)}
    {block.type==="slider" && items.length>1 ? <Box sx={{display:"flex",alignItems:"center",gap:1,flexWrap:"wrap"}}>
      <Button type="button" variant="outlined" sx={{minHeight:44,"&:focus-visible":{outline:"3px solid",outlineColor:"primary.main",outlineOffset:2}}} disabled={current===0} onClick={()=>setPosition(current-1)}>Previous slide</Button>
      <Box component="span" aria-live="polite" aria-atomic="true">{current+1} of {items.length}</Box>
      <Button type="button" variant="outlined" sx={{minHeight:44,"&:focus-visible":{outline:"3px solid",outlineColor:"primary.main",outlineOffset:2}}} disabled={current===items.length-1} onClick={()=>setPosition(current+1)}>Next slide</Button>
    </Box> : null}
  </Box>;
}

function PublishedImage({ block, siteId }: { block: PublicBlock; siteId?: number | null }) {
  const privateBase=useContext(PrivateMediaBase);
  const [failed, setFailed] = useState(false);
  useEffect(()=>setFailed(false),[privateBase,block.ref]);
  const match = typeof block.ref === "string" ? /^sites\/([0-9]+)\/assets\/([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(block.ref) : null;
  if (!match || Number(match[1]) !== siteId || failed) return block.alt ? <Typography component="p">{block.alt}</Typography> : null;
  const assetId = match[2]!.replace(/^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/, "$1-$2-$3-$4-$5");
  const url = privateBase ? `${privateBase}/${assetId}/image` : `/api/v1/site-context/media/${assetId}/`;
  const layout = typeof block.style === "string" && block.style.includes(":")
    ? Object.fromEntries(
        block.style.split(";").filter(Boolean).map((part) => {
          const [prop, ...rest] = part.split(":");
          const key = (prop ?? "").trim().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
          return [key, rest.join(":").trim()];
        }).filter(([key, value]) => key && value),
      )
    : undefined;
  return <Box sx={layout ? { "&::after": { content: '""', display: "table", clear: "both" } } : undefined}>
    <picture>
      <source media="(max-width: 600px)" srcSet={`${url}?variant=thumbnail`} />
      <Box
        component="img"
        src={`${url}?variant=display`}
        alt={block.alt ?? ""}
        loading="lazy"
        onError={() => setFailed(true)}
        style={layout}
        sx={layout ? { height: "auto", borderRadius: 1.5 } : { display:"block", width:"100%", maxWidth: "100%", maxHeight:560, height: "auto", objectFit:"cover" }}
      />
    </picture>
  </Box>;
}

function PageSidebar({ page, preview }: { page: PublicPageDocument; preview: boolean }) {
  const [links, setLinks] = useState<{ title: string; path: string }[]>([]);
  const [state, setState] = useState("loading");
  const [slot,setSlot]=useState<{site:number|null;path:string;items:PublicMenuNode[]}|null>(null);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLinks([]);
    setState("loading");
    setSlot(null);

    if (preview || page.sidebar_id) {
      setState("preview");
      return () => { cancelled = true; controller.abort(); };
    }
    const params = new URLSearchParams({ page_size: "20" });
    if (page.locale) params.set("locale", page.locale);
    fetch(`/api/v1/site-context/pages/?${params}`, {
      ...publicFetchInit(), signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error("Page navigation unavailable");
      const body = await response.json();
      if (!Array.isArray(body.results) || body.results.some((row: { site?: unknown }) => row.site !== page.site)) {
        throw new Error("Page navigation scope mismatch");
      }
      const rows = body.results.map((row: unknown) => pageFromResponse(200, row))
        .filter((row: PublicPageDocument | null): row is PublicPageDocument => Boolean(
          row && row.path !== page.path && row.path.startsWith("/")
          && !row.path.startsWith("//") && safeMenuHref(row.path),
        ));
      if (!cancelled) {
        setLinks(rows.map((row: PublicPageDocument) => ({ title: row.title, path: row.path })));
        setState("ready");
      }
    }).catch(() => { if (!cancelled) setState("error"); });
    if (!preview && !page.sidebar_id) {
      fetch('/api/v1/site-context/menus/?location=sidebar',{...publicFetchInit(),signal:controller.signal}).then(async response=>{
        const body=response.ok?await response.json():null;
        if (!cancelled && body?.site===page.site && (body?.locations?.sidebar?.length || body?.configured_locations?.includes('sidebar'))) {
          setSlot({site:page.site,path:page.path,items:menusFromResponse(200,{locations:{header:body.locations.sidebar}}).header});
        }
      }).catch(()=>{});
    }

    return () => { cancelled = true; controller.abort(); };
  }, [page.site, page.path, page.locale, page.sidebar_id, preview]);
  if (page.sidebar_id) {
    const snapshot = sidebarFromResponse(page.sidebar_snapshot, page.site, page.sidebar_id);
    return <Box component="aside" aria-label="Page navigation" sx={{ gridArea: "sidebar", minWidth: 0, p: 3, bgcolor: "action.hover", borderRadius: 2, alignSelf: "start", overflowWrap: "anywhere" }}>
      <Typography component="h2" variant="h6" sx={{ mb: 2 }}>{snapshot?.name ?? "Page navigation"}</Typography>
      {snapshot ? snapshot.components.map(component => <Box component="nav" key={component.id} aria-label={component.title ?? snapshot.name} sx={{ mb: 3 }}>
        <Typography component="h3" variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>{component.title ?? "Navigation"}</Typography>
        {component.state === "unavailable" ? <Typography variant="body2">This content is currently unavailable.</Typography> : component.items.length ? <SidebarLinks items={component.items} /> : <Typography variant="body2">{component.type === "recent_posts" ? "No published news yet." : component.type === "related_pages" ? "No published related Pages yet." : "No published navigation links yet."}</Typography>}
      </Box>) : <Typography variant="body2">Navigation is currently unavailable.</Typography>}
    </Box>;
  }
  if (slot?.site===page.site && slot?.path===page.path) return <Box component="aside" aria-label="Page navigation" sx={{gridArea:"sidebar",minWidth:0,p:3,bgcolor:"action.hover",borderRadius:2,overflowWrap:"anywhere"}}>
    <Typography component="h2" variant="h6">Page navigation</Typography>
    {slot.items.length?<SiteNavigation items={slot.items} label="Page sidebar"/>:<Typography>No navigation is assigned to this location.</Typography>}
  </Box>;
  return (
    <Box component="aside" aria-label="Page navigation" sx={{
      gridArea: "sidebar", minWidth: 0, p: 3, bgcolor: "action.hover",
      borderRadius: 2, alignSelf: "start", overflowWrap: "anywhere",
    }}>
      <Typography component="h2" variant="h6" sx={{ mb: 2 }}>Explore this Site</Typography>
      <Box component="nav" aria-label="Published Pages" sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        {!preview ? <Link href="/">Site home</Link> : <Typography variant="body2">Published page navigation</Typography>}
        {links.map(link => <Link key={link.path} href={link.path}>{link.title}</Link>)}
      </Box>
      {state === "loading" ? <Typography role="status" variant="body2" sx={{ mt: 2 }}>Loading page links...</Typography> : null}
      {state === "error" ? <Typography variant="body2" sx={{ mt: 2 }}>Other page links are unavailable.</Typography> : null}
    </Box>
  );
}

export function PublicPageView({ page, privateMediaBase, viewportWidth }: { page: PublicPageDocument | null; privateMediaBase?: string; viewportWidth?: number }): ReactNode {
  const site = usePublicSiteBranding();
  if (!page) {
    return (
      <Typography role="status" color="text.secondary">
        This Site has no published page to show.
      </Typography>
    );
  }
  const shell = page.layout === "LEFT_SIDEBAR" || page.layout === "RIGHT_SIDEBAR"
    ? page.layout : "FULL_WIDTH";
  // The Page title owns the H1 unless exactly one layout hero supplies it.
  // Invalid or legacy settings fall back to a visible title rather than
  // publishing a Page with no main heading.
  const heading = page.visual_layout ? resolvePageHeading(page.visual_layout) : null;
  const titleHidden = heading ? !heading.titleVisible : false;
  // One resolver drives the builder canvas and the public Page alike.
  const pageWidth = page.visual_layout ? resolvePageWidth(page.visual_layout.settings) : null;
  // Block-built Pages share the same standard column as posts and the title banner.
  const contentMaxWidth = pageWidth?.maxWidth ?? PAGE_CONTENT_WIDTHS.wide;
  // Explicit opt-out only: a stored "global" or absent value keeps the shell.
  const chromeFree = page.visual_layout?.settings?.chrome === "none";
  // Homepages lead with layout heroes — the title banner stays off.
  const showTitleBanner = !chromeFree && !page.is_homepage;
  // Device preview uses its explicit canvas width rather than the surrounding browser.
  const stacked = viewportWidth !== undefined && viewportWidth < 900;
  const columns = shell === "FULL_WIDTH" || stacked ? "minmax(0,1fr)" : {
    xs: "minmax(0,1fr)",
    md: shell === "LEFT_SIDEBAR"
      ? "minmax(200px,260px) minmax(0,1fr)"
      : "minmax(0,1fr) minmax(200px,260px)",
  };
  const areas = shell === "FULL_WIDTH" ? '"content"' : stacked ? '"content" "sidebar"' : {
    xs: '"content" "sidebar"',
    md: shell === "LEFT_SIDEBAR" ? '"sidebar content"' : '"content sidebar"',
  };
  const bannerStyle = resolveContentBannerStyle(site.banner, "page", page.title_banner ?? null);
  // Homepage never shows a title strip; keep the node for aria-labelledby / H1 fallback.
  const hidePageTitle = Boolean(page.is_homepage) || titleHidden;
  return (
    <PrivateMediaBase.Provider value={privateMediaBase ?? null}>
      <Box
        data-page-layout={shell}
        data-page-homepage={page.visual_layout && page.is_homepage ? "true" : undefined}
        data-page-width={pageWidth?.width}
        data-page-bleed={pageWidth?.bleed ? "true" : undefined}
        data-page-gutter={pageWidth ? `${pageWidth.gutter}px` : undefined}
        data-page-chrome={chromeFree ? "none" : undefined}
        data-site-code={site.code ?? ""}
        sx={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0, gap: 0 }}
      >
        {showTitleBanner ? (
          <ContentBanner
            title={page.title}
            titleId="public-page-title"
            style={bannerStyle}
            titleHidden={titleHidden}
            breadcrumbs={crumbsFromPagePath(page.path)}
            watermarkSrc={publicLogoSource(site)}
          />
        ) : null}
        <Box
          sx={{
            display: "grid", width: "100%", minWidth: 0, gap: { xs: 3, md: 4 },
            gridTemplateColumns: columns, gridTemplateAreas: areas,
            // Shell drops its gutters for edge-to-edge title banners; restore the standard column inset.
            ...(pageWidth ? { px: `${pageWidth.gutter}px` } : { px: { xs: 2, sm: 3, md: 4 }, maxWidth: PAGE_CONTENT_WIDTHS.wide, mx: "auto" }),
            pt: page.is_homepage ? 0 : { xs: 3, md: 4 },
          }}
        >
          <Box
            component="article"
            aria-labelledby="public-page-title"
            sx={{ gridArea: "content", display: "flex", flexDirection: "column", gap: 2, minWidth: 0, width: "100%", maxWidth: contentMaxWidth, mx: "auto", overflowWrap: "anywhere" }}
          >
            {!showTitleBanner ? (
              <>
                {chromeFree ? (
                  <Box component="nav" aria-label="Page navigation" sx={{ borderBottom: 1, borderColor: "divider", pb: 1 }}>
                    <Link href="/" sx={{ fontWeight: 700, minHeight: 44, display: "inline-flex", alignItems: "center", ...focusRing }}>← Site home</Link>
                  </Box>
                ) : null}
                <Typography
                  id="public-page-title"
                  variant="h3"
                  component={titleHidden ? "span" : "h1"}
                  data-page-title-hidden={hidePageTitle ? "true" : undefined}
                  style={hidePageTitle ? SR_ONLY_TITLE_STYLE : undefined}
                  sx={hidePageTitle ? undefined : { overflowWrap: "anywhere" }}
                >
                  {page.title}
                </Typography>
              </>
            ) : null}
            {page.layout_unavailable ? <Typography role="status">This page content is currently unavailable.</Typography> : page.visual_layout ? <VisualLayoutView layout={page.visual_layout} siteId={page.site} pageTitle={page.title} pageId={page.id} preview={Boolean(privateMediaBase)} mediaBase={privateMediaBase} viewportWidth={viewportWidth} demoteH1={heading?.demoteLayoutH1 ?? false} /> : <BlockList blocks={page.blocks} siteId={page.site} />}
          </Box>
          {shell !== "FULL_WIDTH" ? <PageSidebar key={`${page.site}:${page.path}`} page={page} preview={Boolean(privateMediaBase)} /> : null}
        </Box>
      </Box>
    </PrivateMediaBase.Provider>
  );
}
