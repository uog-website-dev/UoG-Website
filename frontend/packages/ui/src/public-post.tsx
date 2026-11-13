"use client";

/**
 * Published Post feed and detail for the Site the backend already resolved.
 *
 * Callers pass documents from the public Post routes. A non-200 response,
 * a draft status, or a disabled POSTS module renders nothing. Body HTML is
 * reduced to text and safe links. Script and javascript: targets are not mounted.
 */
import { useState } from "react";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";

import { paragraphParts } from "./public-page";
import { ArticleDocumentView } from "./article-document";
import { VisualPostProvider, PostTitleWidget, PostExcerptWidget, FeaturedImageWidget } from "./widget-runtime";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface PublicTaxonomyRef {
  name: string;
  slug: string;
}

export interface PublicPostSummary {
  id?: string;
  site?: number;
  featured_media?: string;
  featured_alt?: string;
  title: string;
  slug: string;
  excerpt: string;
  published_at?: string;
  publication_version?: number;
  author?: string;
  seo: { title: string; description: string };
  categories: PublicTaxonomyRef[];
  tags: PublicTaxonomyRef[];
}

export interface PublicPostDocument extends PublicPostSummary {
  body: string;
  editor_document?: unknown;
}

function plainSeo(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

function taxonomyRefs(value: unknown): PublicTaxonomyRef[] {
  if (!Array.isArray(value)) return [];
  const refs: PublicTaxonomyRef[] = [];
  for (const item of value) {
    if (item == null || typeof item !== "object") continue;
    const row = item as { name?: unknown; slug?: unknown };
    if (typeof row.name !== "string" || !row.name.trim()) continue;
    if (typeof row.slug !== "string" || !SLUG.test(row.slug)) continue;
    refs.push({ name: row.name.trim(), slug: row.slug });
  }
  return refs;
}

function summaryFrom(row: Record<string, unknown>): PublicPostSummary | null {
  if (row.status != null && row.status !== "PUBLISHED") return null;
  if (typeof row.title !== "string" || !row.title.trim()) return null;
  if (typeof row.slug !== "string" || !SLUG.test(row.slug)) return null;
  const seo = row.seo != null && typeof row.seo === "object" && !Array.isArray(row.seo)
    ? (row.seo as { meta_title?: unknown; meta_description?: unknown })
    : {};
  const author = typeof row.author === "string" ? row.author.replace(/<[^>]*>/g, "").trim() : "";
  return {
    ...(typeof row.id === "string" ? { id: row.id } : {}),
    ...(typeof row.site === "number" ? { site: row.site } : {}),
    ...(typeof row.featured_media === "string" ? { featured_media: row.featured_media } : {}),
    featured_alt: typeof row.featured_alt === "string" ? row.featured_alt : "",
    title: row.title.trim(),
    slug: row.slug,
    excerpt: typeof row.excerpt === "string" ? row.excerpt : "",
    ...(typeof row.published_at === "string" && row.published_at.trim()
      ? { published_at: row.published_at.trim() }
      : {}),
    ...(typeof row.publication_version === "number" ? {publication_version:row.publication_version} : {}),
    ...(author ? { author } : {}),
    seo: {
      title: plainSeo(seo.meta_title, 120),
      description: plainSeo(seo.meta_description, 300),
    },
    categories: taxonomyRefs(row.categories),
    tags: taxonomyRefs(row.tags),
  };
}

/** Turn a public feed into summaries. 404 and a missing feed become null. */
export function postsFromResponse(status: number, body: unknown): PublicPostSummary[] | null {
  if (status !== 200 || body == null || typeof body !== "object" || Array.isArray(body)) return null;
  const results = (body as { results?: unknown }).results;
  if (!Array.isArray(results)) return null;
  const posts: PublicPostSummary[] = [];
  for (const item of results) {
    if (item == null || typeof item !== "object" || Array.isArray(item)) continue;
    const post = summaryFrom(item as Record<string, unknown>);
    if (post) posts.push(post);
  }
  return posts;
}

/** Turn one public detail response into a document. Drafts and 404 become null. */
export function postFromResponse(status: number, body: unknown): PublicPostDocument | null {
  if (status !== 200 || body == null || typeof body !== "object" || Array.isArray(body)) return null;
  const row = body as Record<string, unknown>;
  const summary = summaryFrom(row);
  if (!summary) return null;
  return {
    ...summary,
    body: typeof row.content === "string" ? row.content : "",
    ...(row.editor_document ? { editor_document: row.editor_document } : {}),
  };
}

function formatPublishedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function RichText({ html }: { html: string }): ReactNode {
  const parts = paragraphParts(html);
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

export interface PublicPostPageResult {
  count: number;
  hasNext: boolean;
  hasPrevious: boolean;
  posts: PublicPostSummary[];
}

export function postsPageFromResponse(status:number,body:unknown,siteId:number):PublicPostPageResult | null {
  const posts = postsFromResponse(status,body);
  if (!posts || !body || typeof body !== "object") return null;
  const row = body as Record<string,unknown>;
  if (!Number.isSafeInteger(row.count) || (row.count as number) < 0
      || !Array.isArray(row.results) || row.results.length !== posts.length
      || posts.some(post => post.site !== siteId)
      || (row.next !== null && typeof row.next !== "string")
      || (row.previous !== null && typeof row.previous !== "string")) return null;
  return {count:row.count as number,hasNext:Boolean(row.next),hasPrevious:Boolean(row.previous),posts};
}

function NewsThumbnail({post}:{post:PublicPostSummary}) {
  const [failed,setFailed] = useState(false);
  const match = /^sites\/([1-9][0-9]*)\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(post.featured_media ?? "");
  const available = match && Number(match[1]) === post.site && !failed;
  return <Box sx={{aspectRatio:"16 / 9",bgcolor:"grey.100",display:"grid",placeItems:"center",overflow:"hidden"}}>
    {available ? <Box component="img" src={`/api/v1/site-context/media/${match[2]}/?variant=thumbnail`} alt={post.featured_alt || ""} loading="lazy" onError={() => setFailed(true)} sx={{width:"100%",height:"100%",objectFit:"cover"}} />
      : <Box role="img" aria-label="No image available" sx={{display:"grid",placeItems:"center",color:"text.secondary"}}><DescriptionOutlinedIcon aria-hidden sx={{fontSize:40}} /></Box>}
  </Box>;
}

export function PublicPostFeed({ posts }: { posts: PublicPostSummary[] | null }): ReactNode {
  if (!posts || posts.length === 0) return <Typography role="status" color="text.secondary">This Site has no published posts to show.</Typography>;
  return <Box component="ul" data-testid="public-post-feed" aria-label="Published posts" sx={{listStyle:"none",p:0,m:0,display:"grid",gridTemplateColumns:{xs:"minmax(0,1fr)",sm:"repeat(2,minmax(0,1fr))",lg:"repeat(3,minmax(0,1fr))"},gap:3,width:"100%"}}>
    {posts.map(post => <Box component="li" key={`${post.id || post.slug}:${post.publication_version ?? 0}`} sx={{minWidth:0,display:"flex"}}>
      <Box component="article" sx={{width:"100%",border:1,borderColor:"divider",borderRadius:2,overflow:"hidden",bgcolor:"background.paper",display:"flex",flexDirection:"column","&:focus-within":{outline:"3px solid",outlineColor:"primary.main",outlineOffset:3}}}>
        <NewsThumbnail post={post} />
        <Box sx={{p:2.5,display:"flex",flexDirection:"column",gap:1.5,flex:1}}>
          {post.categories[0] ? <Typography component="a" href={`/posts/categories/${encodeURIComponent(post.categories[0].slug)}`} variant="overline" color="primary.main" sx={{lineHeight:1.4,textDecoration:"none","&:hover":{textDecoration:"underline"}}}>{post.categories[0].name}</Typography> : null}
          <Typography component="h2" variant="h5" sx={{fontWeight:700,fontSize:"1.3rem",lineHeight:1.35,overflowWrap:"anywhere"}}><Link href={`/posts/${post.slug}`} underline="hover" color="inherit">{post.title}</Link></Typography>
          {post.excerpt ? <Typography color="text.secondary" sx={{overflowWrap:"anywhere",lineHeight:1.7}}>{post.excerpt}</Typography> : null}
          {post.published_at && !Number.isNaN(Date.parse(post.published_at)) ? <Typography component="time" dateTime={post.published_at} variant="body2" color="text.secondary" sx={{mt:"auto",pt:1}}>{formatPublishedAt(post.published_at)}</Typography> : null}
        </Box>
      </Box>
    </Box>)}
  </Box>;
}

export function PublicPostDetail({
  post,
  mediaBase,
  showListingLink = true,
}: {
  post: PublicPostDocument | null;
  mediaBase?: string;
  /** When false, omit the public “Back to posts” link (private Site preview). */
  showListingLink?: boolean;
}): ReactNode {
  if (!post) {
    return (
      <Typography role="status" color="text.secondary">
        This Site has no published post to show.
      </Typography>
    );
  }
  const taxonomy = [...post.categories.map((item) => item.name), ...post.tags.map((item) => item.name)];
  const scoped = post.site !== undefined;

  return (
    <VisualPostProvider
      siteId={post.site ?? null}
      post={
        scoped
          ? {
              id: post.id ?? post.slug,
              site: post.site!,
              title: post.title,
              slug: post.slug,
              excerpt: post.excerpt,
              featured_media: post.featured_media ?? "",
              featured_alt: post.featured_alt ?? "",
            }
          : null
      }
    >
      <Box component="article" aria-labelledby="public-post-title" sx={{ display: "flex", flexDirection: "column", width: "100%" }}>
        <Box
          component="header"
          aria-label="Article banner"
          sx={{
            bgcolor: "grey.900",
            color: "common.white",
            mb: 3,
            overflow: "hidden",
          }}
        >
          {scoped ? <FeaturedImageWidget compact variant="hero" /> : null}
          <Box
            sx={{
              px: { xs: 2, sm: 3 },
              py: { xs: 3, sm: 4 },
              maxWidth: "65ch",
              "& .MuiTypography-root": { color: "inherit" },
            }}
          >
            {scoped ? (
              <PostTitleWidget id="public-post-title" level={1} />
            ) : (
              <Typography
                id="public-post-title"
                variant="h1"
                component="h1"
                sx={{ fontSize: { xs: "1.75rem", sm: "2.5rem" }, overflowWrap: "anywhere" }}
              >
                {post.title}
              </Typography>
            )}
            {scoped ? (
              <Box sx={{ mt: 1, opacity: 0.9 }}>
                <PostExcerptWidget />
              </Box>
            ) : post.excerpt ? (
              <Typography sx={{ mt: 1, opacity: 0.9, overflowWrap: "anywhere" }}>{post.excerpt}</Typography>
            ) : null}
          </Box>
        </Box>

        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, px: { xs: 2, sm: 3 }, pb: 4, maxWidth: "65ch", width: "100%" }}>
          {showListingLink ? (
            <Link href="/posts" underline="hover" sx={{ alignSelf: "flex-start", fontWeight: 600 }}>
              Back to posts
            </Link>
          ) : null}
          {post.published_at || post.author || taxonomy.length > 0 ? (
            <Typography
              component="p"
              variant="body2"
              color="text.secondary"
              sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center" }}
            >
              {post.published_at ? (
                <Box component="time" dateTime={post.published_at}>
                  {formatPublishedAt(post.published_at)}
                </Box>
              ) : null}
              {post.published_at && (post.author || taxonomy.length > 0) ? <Box component="span" aria-hidden>·</Box> : null}
              {post.author ? <Box component="span">{post.author}</Box> : null}
              {post.author && taxonomy.length > 0 ? <Box component="span" aria-hidden>·</Box> : null}
              {taxonomy.length > 0 ? <Box component="span">{taxonomy.join(" · ")}</Box> : null}
            </Typography>
          ) : null}
          {post.editor_document ? (
            <ArticleDocumentView siteId={post.site} mediaBase={mediaBase} document={post.editor_document} />
          ) : (
            <RichText html={post.body} />
          )}
        </Box>
      </Box>
    </VisualPostProvider>
  );
}
