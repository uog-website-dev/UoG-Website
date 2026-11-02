"use client";

/**
 * Published Page for the path on this hostname.
 *
 * The fetch does not follow redirects itself. A 308 becomes a path on this
 * website. A draft, a disabled PAGES module, or another Site's document is
 * shown as not found.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Typography from "@mui/material/Typography";
import {
  pageFromResponse,
  pageMetadata,
  publicFetchInit,
  PublicPageView,
  safePagePath,
  sameSite,
  siteFromContext,
  websitePathFromRedirect,
} from "@uog/ui";
import type { PublicPageDocument, PublicSiteContext } from "@uog/ui";

export function PublicPathPage({ segments }: { segments: string[] }) {
  const router = useRouter();
  const path = safePagePath(segments);
  const [page, setPage] = useState<PublicPageDocument | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!path) {
      setPage(null);
      setReady(true);
      return;
    }
    let cancelled = false;
    Promise.all([
      fetch("/api/v1/site-context/", publicFetchInit()).then(async (response) => {
        const body = response.ok ? await response.json().catch(() => null) : null;
        return siteFromContext(response.status, body);
      }),
      fetch(`/api/v1/site-context/pages${path}/`, publicFetchInit()),
    ])
      .then(async ([site, response]) => {
        if (cancelled) return;
        if (response.status === 308 || response.status === 301 || response.status === 302 || response.status === 307) {
          const next = websitePathFromRedirect(response.headers.get("Location"));
          if (next && next !== path) {
            router.replace(next);
            return;
          }
          setPage(null);
          setReady(true);
          return;
        }
        const body = response.ok ? await response.json().catch(() => null) : null;
        const pageDocument = pageFromResponse(response.status, body);
        const visible = pageDocument && site.modules.pages && sameSite(pageDocument.site, site.id) ? pageDocument : null;
        applyMetadata(site, visible);
        setPage(visible);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setPage(null);
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path, router]);

  if (!ready) return <Typography role="status">Loading published page…</Typography>;
  return <PublicPageView page={page} />;
}

function applyMetadata(site: PublicSiteContext, page: PublicPageDocument | null) {
  const metadata = pageMetadata(site, page);
  document.title = metadata.title;
  let description = document.querySelector('meta[name="description"]');
  if (!description) {
    description = document.createElement("meta");
    description.setAttribute("name", "description");
    document.head.appendChild(description);
  }
  description.setAttribute("content", metadata.description);
}
