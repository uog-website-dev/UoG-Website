"use client";

/**
 * Full-viewport private Post preview (WordPress-style new-tab target).
 * Renders Site header/footer chrome around the article hero and body.
 */
import Link from "next/link";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { PublicPostDetail, UogFooter, UogHeader, useAsync, WidgetRuntimeProvider } from "@uog/ui";
import { getSitePostPreview } from "@/app/sites/post-actions";
import { APP_BASE_PATH } from "@/base-path";
import { unwrap } from "@/organizations/contract";
import { useSiteAdmin } from "@/sites/site-admin-frame";

export function SitePostPreview({ siteId, postId }: { siteId: number; postId: string }) {
  const { site } = useSiteAdmin();
  const state = useAsync(async () => unwrap(await getSitePostPreview(siteId, postId)), [siteId, postId]);

  const mediaBase = `${APP_BASE_PATH}/sites/${siteId}/media`;
  const post = state.data;
  const document = post
    ? {
        id: post.id,
        site: siteId,
        title: post.title,
        slug: post.publication_slug || post.slug,
        excerpt: post.excerpt,
        featured_media: post.featured_media,
        featured_alt: post.featured_alt ?? "",
        body: post.content,
        editor_document: post.editor_document,
        categories: [],
        tags: [],
        seo: { title: "", description: "" },
        ...(typeof post.published_at === "string" ? { published_at: post.published_at } : {}),
      }
    : null;

  return (
    <Box sx={{ position: "fixed", inset: 0, zIndex: 1201, overflow: "auto", bgcolor: "background.paper", minWidth: 0 }}>
      <Box
        sx={{
          position: "sticky",
          top: 0,
          zIndex: 2,
          px: 2,
          py: 1,
          bgcolor: "#1c242c",
          color: "white",
          display: "flex",
          gap: 1,
          flexWrap: "wrap",
          alignItems: "center",
          "& .MuiButton-root": { color: "white" },
        }}
      >
        <Typography variant="body2" component="p" sx={{ flex: 1, minWidth: 0 }}>
          {post?.title ?? "Post preview"}
          {post ? ` · Preview · ${post.status.replaceAll("_", " ")} · Revision ${post.revision_number}` : ""}
        </Typography>
        <Button component={Link} href={`/sites/${site.id}/admin/posts`} size="small">
          Back to Posts
        </Button>
        {postId ? (
          <Button component={Link} href={`/sites/${site.id}/admin/posts/${postId}/edit`} size="small">
            Open editor
          </Button>
        ) : null}
      </Box>

      {state.loading ? (
        <Box role="status" sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress size={28} />
          <Typography sx={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
            Loading private article preview…
          </Typography>
        </Box>
      ) : state.error ? (
        <Alert severity="error" sx={{ m: 2 }}>{state.error.message}</Alert>
      ) : document ? (
        <Box
          component="section"
          aria-label="Full post preview"
          sx={{
            display: "flex",
            flexDirection: "column",
            minHeight: "calc(100dvh - 50px)",
            bgcolor: "background.paper",
          }}
        >
          <UogHeader title={site.name} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <WidgetRuntimeProvider siteId={siteId} preview mediaBase={mediaBase}>
              <PublicPostDetail post={document} mediaBase={mediaBase} showListingLink={false} />
            </WidgetRuntimeProvider>
          </Box>
          <UogFooter apiBaseUrl={undefined} />
        </Box>
      ) : (
        <Alert severity="warning" sx={{ m: 2 }}>No preview is available for this Post.</Alert>
      )}
    </Box>
  );
}
