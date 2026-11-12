"use client";

/**
 * Published Page body for the Site the backend already resolved.
 *
 * Callers pass one document from `GET /api/v1/site-context/homepage/` or a
 * public page route. Drafts and a disabled PAGES module (404) render nothing.
 * Paragraph HTML is reduced to text and safe links. Script, event handlers
 * and javascript: targets never become markup.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";

import { safeMenuHref } from "./site-navigation";

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

export interface PublicPageDocument {
  title: string;
  path: string;
  site: number | null;
  blocks: PublicBlock[];
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
  const row = body as { title?: unknown; path?: unknown; status?: unknown; blocks?: unknown; site?: unknown; seo?: unknown };
  if (row.status != null && row.status !== "PUBLISHED") return null;
  if (typeof row.title !== "string" || !row.title.trim()) return null;
  const path = typeof row.path === "string" && row.path.startsWith("/") ? row.path : "/";
  const seo = row.seo != null && typeof row.seo === "object" ? row.seo as { meta_title?: unknown; meta_description?: unknown } : {};
  return {
    title: row.title.trim(),
    path,
    site: typeof row.site === "number" ? row.site : null,
    blocks: normalizeBlocks(row.blocks),
    seo: {
      title: plainSeo(seo.meta_title, 120),
      description: plainSeo(seo.meta_description, 300),
    },
  };
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

function BlockView({ block, siteId }: { block: PublicBlock; siteId?: number | null }) {
  if (block.type === "heading" && block.text) {
    const level = block.level === 2 || block.level === 3 || block.level === 4 ? block.level : 2;
    return (
      <Typography variant={`h${level}` as "h2"} component={`h${level}` as "h2"} sx={{ mt: 2 }}>
        {block.text}
      </Typography>
    );
  }
  if (block.type === "paragraph" && block.html) {
    const parts = paragraphParts(block.html);
    if (parts.length === 0) return null;
    return (
      <Typography component="p" sx={{ maxWidth: "65ch", overflowWrap: "anywhere" }}>
        {parts.map((part, index) =>
          part.type === "link" ? (
            <Link key={index} href={part.href} rel="noopener noreferrer">
              {part.label}
            </Link>
          ) : (
            <Box key={index} component="span">{index > 0 ? " " : ""}{part.value}</Box>
          ),
        )}
      </Typography>
    );
  }
  if (block.type === "button" && block.label) {
    const href = block.href ? safeMenuHref(block.href) : null;
    if (!href) {
      return <Typography component="p">{block.label}</Typography>;
    }
    return (
      <Link href={href} rel="noopener noreferrer" sx={{ fontWeight: 700 }}>
        {block.label}
      </Link>
    );
  }
  if (block.type === "list" && block.items && block.items.length > 0) {
    const Tag = block.style === "ordered" ? "ol" : "ul";
    return (
      <Box component={Tag} sx={{ pl: 3, maxWidth: "65ch" }}>
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
  return <Box component="section" aria-label={block.type==="slider" ? "Image slider" : "Image gallery"} sx={{display:"grid",gap:2}}>
    {shown.map((item) => <Box component="figure" key={`${siteId}-${item.id}-${item.asset_id}`} sx={{m:0}}>
      <PublishedImage block={{type:"image",ref:`sites/${siteId}/assets/${item.asset_id}`,alt:item.alt}} siteId={siteId} />
      {item.caption ? <Typography component="figcaption">{item.caption}</Typography> : null}
    </Box>)}
    {block.type==="slider" && items.length>1 ? <Box>
      <button disabled={current===0} onClick={()=>setPosition(current-1)}>Previous slide</button>
      <span aria-live="polite">{current+1} of {items.length}</span>
      <button disabled={current===items.length-1} onClick={()=>setPosition(current+1)}>Next slide</button>
    </Box> : null}
  </Box>;
}

function PublishedImage({ block, siteId }: { block: PublicBlock; siteId?: number | null }) {
  const [failed, setFailed] = useState(false);
  const match = typeof block.ref === "string" ? /^sites\/([0-9]+)\/assets\/([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(block.ref) : null;
  if (!match || Number(match[1]) !== siteId || failed) return block.alt ? <Typography component="p">{block.alt}</Typography> : null;
  const assetId = match[2]!.replace(/^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/, "$1-$2-$3-$4-$5");
  const url = `/api/v1/site-context/media/${assetId}/`;
  return <picture>
    <source media="(max-width: 600px)" srcSet={`${url}?variant=thumbnail`} />
    <Box component="img" src={`${url}?variant=display`} alt={block.alt ?? ""} loading="lazy" onError={() => setFailed(true)} sx={{ maxWidth: "100%", height: "auto" }} />
  </picture>;
}

export function PublicPageView({ page }: { page: PublicPageDocument | null }): ReactNode {
  if (!page) {
    return (
      <Typography role="status" color="text.secondary">
        This Site has no published page to show.
      </Typography>
    );
  }
  return (
    <Box
      component="article"
      aria-labelledby="public-page-title"
      sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: "100%" }}
    >
      <Typography id="public-page-title" variant="h3" component="h1" sx={{ overflowWrap: "anywhere" }}>
        {page.title}
      </Typography>
      <BlockList blocks={page.blocks} siteId={page.site} />
    </Box>
  );
}
