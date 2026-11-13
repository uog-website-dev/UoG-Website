"use client";

/**
 * Published Post feed and detail for the Site the backend already resolved.
 *
 * Callers pass documents from the public Post routes. A non-200 response,
 * a draft status, or a disabled POSTS module renders nothing. Body HTML is
 * reduced to text and safe links. Script and javascript: targets are not mounted.
 */
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";

import { paragraphParts } from "./public-page";
import {VisualPostProvider,PostTitleWidget,PostExcerptWidget,FeaturedImageWidget} from "./widget-runtime";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface PublicTaxonomyRef {
  name: string;
  slug: string;
}

export interface PublicPostSummary {
  id?:string;
  site?:number;
  featured_media?:string;
  title: string;
  slug: string;
  excerpt: string;
  categories: PublicTaxonomyRef[];
  tags: PublicTaxonomyRef[];
}

export interface PublicPostDocument extends PublicPostSummary {
  body: string;
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
  return {
    ...(typeof row.id==="string"?{id:row.id}:{}),
    ...(typeof row.site==="number"?{site:row.site}:{}),
    ...(typeof row.featured_media==="string"?{featured_media:row.featured_media}:{}),
    title: row.title.trim(),
    slug: row.slug,
    excerpt: typeof row.excerpt === "string" ? row.excerpt : "",
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
  return { ...summary, body: typeof row.content === "string" ? row.content : "" };
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

export function PublicPostFeed({ posts }: { posts: PublicPostSummary[] | null }): ReactNode {
  if (!posts || posts.length === 0) {
    return (
      <Typography role="status" color="text.secondary">
        This Site has no published posts to show.
      </Typography>
    );
  }
  return (
    <Box
      component="ul"
      data-testid="public-post-feed"
      aria-label="Published posts"
      sx={{
        listStyle: "none",
        p: 0,
        m: 0,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        width: "100%",
      }}
    >
      {posts.map((post) => (
        <Box component="li" key={post.slug} sx={{ width: "100%", minWidth: 0 }}>
          <Link href={`/posts/${post.slug}`} sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>
            {post.title}
          </Link>
          {post.excerpt ? (
            <Typography sx={{ maxWidth: "65ch", overflowWrap: "anywhere" }}>{post.excerpt}</Typography>
          ) : null}
          <Typography variant="body2" color="text.secondary">
            {[...post.categories.map((item) => item.name), ...post.tags.map((item) => item.name)].join(" · ") || "Uncategorized"}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

export function PublicPostDetail({ post }: { post: PublicPostDocument | null }): ReactNode {
  if (!post) {
    return (
      <Typography role="status" color="text.secondary">
        This Site has no published post to show.
      </Typography>
    );
  }
  return (
    <VisualPostProvider siteId={post.site??null} post={post.site===undefined?null:{
      id:post.id??post.slug,site:post.site,title:post.title,slug:post.slug,excerpt:post.excerpt,featured_media:post.featured_media??""
    }}><Box
      component="article"
      aria-labelledby="public-post-title"
      sx={{ display: "flex", flexDirection: "column", gap: 2, width: "100%", maxWidth: "65ch" }}
    >
      {post.site!==undefined?<PostTitleWidget id="public-post-title" level={1}/>:<Typography
        id="public-post-title"
        variant="h1"
        component="h1"
        sx={{ fontSize: { xs: "1.75rem", sm: "2.25rem" }, overflowWrap: "anywhere" }}
      >
        {post.title}
      </Typography>}
      {post.site!==undefined?<><PostExcerptWidget/><FeaturedImageWidget compact/></>:null}
      <Typography variant="body2" color="text.secondary">
        {[...post.categories.map((item) => item.name), ...post.tags.map((item) => item.name)].join(" · ")}
      </Typography>
      <RichText html={post.body} />
    </Box></VisualPostProvider>
  );
}
