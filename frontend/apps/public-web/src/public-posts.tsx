"use client";

/**
 * Public Post feed and detail.
 *
 * Both views call the host-resolved Post API. Category and tag filters are
 * slugs for this Site only. A draft, another Site's Post, or a disabled
 * POSTS module comes back as not found and is not rendered.
 */
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { postFromResponse, postsFromResponse, publicFetchInit, PublicPostDetail, PublicPostFeed, siteFromContext } from "@uog/ui";
import type { PublicPostDocument, PublicPostSummary } from "@uog/ui";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function filterValue(value: string | null): string {
  return value && SLUG.test(value) ? value : "";
}

export function PublicPostsPage() {
  const router = useRouter();
  const search = useSearchParams();
  const category = filterValue(search.get("category"));
  const tag = filterValue(search.get("tag"));
  const [draftCategory, setDraftCategory] = useState(category);
  const [draftTag, setDraftTag] = useState(tag);
  const [posts, setPosts] = useState<PublicPostSummary[] | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setDraftCategory(category);
    setDraftTag(tag);
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (tag) params.set("tag", tag);
    const query = params.toString();
    let cancelled = false;
    fetch("/api/v1/site-context/", publicFetchInit())
      .then(async (response) => {
        const body = response.ok ? await response.json().catch(() => null) : null;
        return siteFromContext(response.status, body);
      })
      .then(async (site) => {
        if (!site.modules.posts) return null;
        const response = await fetch(
          `/api/v1/site-context/posts/${query ? `?${query}` : ""}`,
          publicFetchInit(),
        );
        const body = response.ok ? await response.json().catch(() => null) : null;
        return postsFromResponse(response.status, body);
      })
      .catch(() => null)
      .then((next) => {
        if (!cancelled) {
          setPosts(next);
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [category, tag]);

  function applyFilters() {
    const params = new URLSearchParams();
    if (SLUG.test(draftCategory)) params.set("category", draftCategory);
    if (SLUG.test(draftTag)) params.set("tag", draftTag);
    const query = params.toString();
    router.push(query ? `/posts?${query}` : "/posts");
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3, width: "100%" }}>
      <Typography variant="h1" component="h1" sx={{ fontSize: { xs: "1.75rem", sm: "2.25rem" } }}>
        Posts
      </Typography>
      <Box
        component="form"
        aria-label="Post filters"
        onSubmit={(event) => {
          event.preventDefault();
          applyFilters();
        }}
        sx={{ display: "flex", flexDirection: { xs: "column", sm: "row" }, gap: 2, alignItems: { sm: "center" } }}
      >
        <TextField label="Category" value={draftCategory} onChange={(event) => setDraftCategory(event.target.value.trim())} size="small" />
        <TextField label="Tag" value={draftTag} onChange={(event) => setDraftTag(event.target.value.trim())} size="small" />
        <Button type="submit" variant="contained">Apply</Button>
      </Box>
      {ready ? <PublicPostFeed posts={posts} /> : <Typography role="status">Loading published posts…</Typography>}
    </Box>
  );
}

export function PublicPostPage({ slug }: { slug: string }) {
  const [post, setPost] = useState<PublicPostDocument | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!SLUG.test(slug)) {
      setPost(null);
      setReady(true);
      return;
    }
    let cancelled = false;
    fetch("/api/v1/site-context/", publicFetchInit())
      .then(async (response) => {
        const body = response.ok ? await response.json().catch(() => null) : null;
        return siteFromContext(response.status, body);
      })
      .then(async (site) => {
        if (!site.modules.posts) return null;
        const response = await fetch(`/api/v1/site-context/posts/${slug}/`, publicFetchInit());
        const body = response.ok ? await response.json().catch(() => null) : null;
        return postFromResponse(response.status, body);
      })
      .catch(() => null)
      .then((next) => {
        if (!cancelled) {
          setPost(next);
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (!ready) return <Typography role="status">Loading published post…</Typography>;
  return <PublicPostDetail post={post} />;
}
