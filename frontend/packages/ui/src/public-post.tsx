"use client";

/**
 * Published Post feed and detail for the Site the backend already resolved.
 *
 * Callers pass documents from the public Post routes. A non-200 response,
 * a draft status, or a disabled POSTS module renders nothing. Body HTML is
 * reduced to text and safe links. Script and javascript: targets are not mounted.
 */
import { useEffect, useState } from "react";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";

import {containedImageHover,newsCardHover} from "./horizontal-cards";
import { ArticleDocumentView } from "./article-document";
import { VisualPostProvider, PostTitleWidget, FeaturedImageWidget } from "./widget-runtime";
import { ContentBanner, crumbsForPostDetail } from "./content-banner";
import {
  bannerStyleFromUnknown,
  resolveContentBannerStyle,
  type PublicTitleBannerStyle,
} from "./content-banner-model";
import { PUBLIC_CONTENT_MAX_WIDTH } from "./page-width";
import { usePublicSiteBranding } from "./site-branding";
import { publicFetchInit, publicLogoSource } from "./public-site";

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
  title_banner?: PublicTitleBannerStyle | null;
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
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown>
    : {};
  const bannerOverride = Object.hasOwn(row, "title_banner")
    ? postBannerFromMetadata({ title_banner: row.title_banner })
    : postBannerFromMetadata(metadata);
  return {
    ...summary,
    body: typeof row.content === "string" ? row.content : "",
    ...(row.editor_document ? { editor_document: row.editor_document } : {}),
    ...(bannerOverride ? { title_banner: bannerOverride } : {}),
  };
}

function postBannerFromMetadata(metadata: Record<string, unknown>): PublicTitleBannerStyle | null {
  if (!Object.hasOwn(metadata, "title_banner")) return null;
  const value = metadata.title_banner;
  if (value == null) return null;
  if (typeof value === "object" && !Array.isArray(value) && (value as { use_global?: unknown }).use_global === true) {
    return null;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const row = value as Record<string, unknown>;
    if (Object.keys(row).every((key) => key === "use_global" || key === "enabled") && typeof row.enabled === "boolean") {
      return { ...resolveContentBannerStyle(undefined, "post"), enabled: row.enabled };
    }
  }
  const parsed = bannerStyleFromUnknown(value);
  if (!parsed) return null;
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

function formatPublishedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
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
  return <Box data-image-hover="zoom" sx={{...containedImageHover,aspectRatio:"16 / 9",bgcolor:"grey.100",display:"grid",placeItems:"center",overflow:"hidden"}}>
    {available ? <Box component="img" src={`/api/v1/site-context/media/${match[2]}/?variant=thumbnail`} alt={post.featured_alt || ""} loading="lazy" onError={() => setFailed(true)} sx={{width:"100%",height:"100%",objectFit:"cover"}} />
      : <Box role="img" aria-label="No image available" sx={{display:"grid",placeItems:"center",color:"text.secondary"}}><DescriptionOutlinedIcon aria-hidden sx={{fontSize:40}} /></Box>}
  </Box>;
}

export function PublicPostFeed({ posts }: { posts: PublicPostSummary[] | null }): ReactNode {
  if (!posts || posts.length === 0) return <Typography role="status" color="text.secondary">This Site has no published posts to show.</Typography>;
  return <Box component="ul" data-testid="public-post-feed" aria-label="Published posts" sx={{listStyle:"none",p:0,m:0,display:"grid",gridTemplateColumns:{xs:"minmax(0,1fr)",sm:"repeat(2,minmax(0,1fr))",lg:"repeat(3,minmax(0,1fr))"},gap:3,width:"100%"}}>
    {posts.map(post => <Box component="li" key={`${post.id || post.slug}:${post.publication_version ?? 0}`} sx={{minWidth:0,display:"flex"}}>
      <Box component="article" sx={{...newsCardHover,width:"100%",border:1,borderColor:"divider",borderRadius:2,overflow:"hidden",bgcolor:"background.paper",display:"flex",flexDirection:"column","&:focus-within":{outline:"3px solid",outlineColor:"primary.main",outlineOffset:3}}}>
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

/** Related feed under a post detail — grid of other recent posts plus All news. */
function LatestPostsSection({ excludeSlug }: { excludeSlug: string }): ReactNode {
  const [posts, setPosts] = useState<PublicPostSummary[] | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "empty">("loading");

  useEffect(() => {
    const controller = new AbortController();
    setPhase("loading");
    void fetch("/api/v1/site-context/posts/?page_size=6", { ...publicFetchInit(), signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        const list = (postsFromResponse(response.status, body) ?? []).filter((item) => item.slug !== excludeSlug).slice(0, 3);
        setPosts(list);
        setPhase(list.length > 0 ? "ready" : "empty");
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setPosts([]);
        setPhase("empty");
      });
    return () => controller.abort();
  }, [excludeSlug]);

  return (
    <Box
      component="section"
      aria-label="Latest posts"
      data-latest-posts-section=""
      sx={{ mt: 1, pt: 4, borderTop: 1, borderColor: "divider", display: "grid", gap: 2.5 }}
    >
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
        <Typography component="h2" variant="h5" sx={{ m: 0, fontWeight: 700 }}>
          Latest posts
        </Typography>
        <Button
          component={Link}
          href="/posts"
          underline="none"
          variant="outlined"
          color="primary"
          sx={{
            fontWeight: 700,
            textTransform: "none",
            px: 2,
            py: 1,
            "&:focus-visible": { outline: "3px solid", outlineColor: "secondary.main", outlineOffset: 3 },
          }}
        >
          All news
        </Button>
      </Box>
      {phase === "loading" ? (
        <Typography role="status" color="text.secondary">
          Loading latest posts…
        </Typography>
      ) : null}
      {phase === "ready" && posts ? <PublicPostFeed posts={posts} /> : null}
      {phase === "empty" ? (
        <Typography role="status" color="text.secondary">
          No other published posts yet.{" "}
          <Link href="/posts" underline="hover">
            Browse all news
          </Link>
        </Typography>
      ) : null}
    </Box>
  );
}

export function PublicPostDetail({
  post,
  mediaBase,
  showListingLink = true,
}: {
  post: PublicPostDocument | null;
  mediaBase?: string;
  /** When false, omit the public latest-posts grid (private Site preview). */
  showListingLink?: boolean;
}): ReactNode {
  const site = usePublicSiteBranding();
  if (!post) {
    return (
      <Typography role="status" color="text.secondary">
        This Site has no published post to show.
      </Typography>
    );
  }
  const publishedAt = post.published_at && !Number.isNaN(Date.parse(post.published_at))
    ? post.published_at
    : null;
  const scoped = post.site !== undefined;
  const hasFeatured = scoped && Boolean(post.featured_media);
  /** Align with the banner / page standard column. */
  const contentMaxWidth = PUBLIC_CONTENT_MAX_WIDTH;
  const bannerStyle = {
    ...resolveContentBannerStyle(site.banner, "post", post.title_banner ?? null),
    // Tall upper band: title stays above the overlapping featured frame.
    height: "lg" as const,
    content_position: "top" as const,
    padding_y: "md" as const,
  };

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
      <Box
        component="article"
        aria-labelledby="public-post-title"
        data-post-layout="featured-overlay"
        sx={{ display: "flex", flexDirection: "column", width: "100%" }}
      >
        <Box
          data-post-hero=""
          sx={{
            position: "relative",
            // Extra navy under the title so the featured frame can cover the lower band.
            "& [data-content-banner='styled']": {
              pb: hasFeatured ? { xs: 10, sm: 12, md: 14 } : undefined,
            },
          }}
        >
          <ContentBanner
            title={post.title}
            titleId="public-post-title"
            style={bannerStyle}
            breadcrumbs={crumbsForPostDetail()}
            watermarkSrc={publicLogoSource(site)}
          >
            {scoped ? (
              <Box sx={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }} aria-hidden>
                <PostTitleWidget id="public-post-title-widget" level={1} />
              </Box>
            ) : null}
          </ContentBanner>
        </Box>

        {hasFeatured ? (
          <Box
            data-post-featured-overlay=""
            sx={{
              position: "relative",
              zIndex: 3,
              maxWidth: contentMaxWidth,
              width: "100%",
              mx: "auto",
              px: { xs: 2, sm: 3, md: 4 },
              // Pull into the banner, then keep a clear gap before the article body.
              mt: { xs: -12, sm: -14, md: -16 },
              mb: { xs: 3, sm: 4, md: 5 },
            }}
          >
            <Box
              sx={{
                overflow: "hidden",
                borderRadius: { xs: 1, sm: 1.5 },
                boxShadow: "0 22px 48px rgba(0, 26, 51, 0.35)",
                bgcolor: "grey.100",
              }}
            >
              <FeaturedImageWidget compact variant="hero" />
            </Box>
          </Box>
        ) : null}

        <Box
          sx={{
            maxWidth: contentMaxWidth,
            width: "100%",
            mx: "auto",
            px: { xs: 2, sm: 3, md: 4 },
            pt: hasFeatured ? { xs: 1, md: 1.5 } : { xs: 3, md: 4 },
            pb: { xs: 2, md: 2.5 },
          }}
        >
          {publishedAt || post.author ? (
            <Typography
              component="p"
              variant="body2"
              color="text.secondary"
              data-post-byline=""
              sx={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 0.75,
                m: 0,
                mb: post.categories.length + post.tags.length > 0 ? 2 : 0,
                fontWeight: 500,
              }}
            >
              {publishedAt ? (
                <Box component="time" dateTime={publishedAt} data-post-published="">
                  {formatPublishedAt(publishedAt)}
                </Box>
              ) : null}
              {publishedAt && post.author ? <Box component="span" aria-hidden>·</Box> : null}
              {post.author ? <Box component="span">{post.author}</Box> : null}
            </Typography>
          ) : null}
          {post.categories.length + post.tags.length > 0 ? (
            <Box component="nav" aria-label="Article topics" sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 2.5 }}>
              {post.categories.map((item) => (
                <Link key={`category:${item.slug}`} href={`/posts/categories/${encodeURIComponent(item.slug)}`} underline="none" sx={{ px: 1.25, py: 0.5, borderRadius: 99, bgcolor: "action.hover", color: "text.secondary", fontSize: "0.8rem", fontWeight: 600, "&:hover": { bgcolor: "action.selected", color: "primary.main" } }}>
                  {item.name}
                </Link>
              ))}
              {post.tags.map((item) => (
                <Link key={`tag:${item.slug}`} href={`/posts?tag=${encodeURIComponent(item.slug)}`} underline="none" sx={{ px: 1.25, py: 0.5, borderRadius: 99, bgcolor: "action.hover", color: "text.secondary", fontSize: "0.8rem", fontWeight: 600, "&:hover": { bgcolor: "action.selected", color: "primary.main" } }}>
                  {item.name}
                </Link>
              ))}
            </Box>
          ) : null}
        </Box>

        <Box
          data-post-body=""
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            pt: post.categories.length + post.tags.length > 0 ? 1 : 0,
            pb: showListingLink ? 2 : { xs: 5, md: 7 },
            maxWidth: contentMaxWidth,
            width: "100%",
            mx: "auto",
            px: { xs: 2, sm: 3, md: 4 },
          }}
        >
          <ArticleDocumentView
            siteId={post.site}
            mediaBase={mediaBase}
            document={post.editor_document ?? { schema_version: 1, html: post.body || "" }}
            maxWidth="none"
          />
        </Box>
        {showListingLink ? (
          <Box sx={{ maxWidth: 1100, width: "100%", mx: "auto", px: { xs: 2, sm: 3 }, pb: { xs: 5, md: 7 } }}>
            <LatestPostsSection excludeSlug={post.slug} />
          </Box>
        ) : null}
      </Box>
    </VisualPostProvider>
  );
}
