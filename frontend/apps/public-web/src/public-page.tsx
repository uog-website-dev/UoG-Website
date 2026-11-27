"use client";

/**
 * Published Page for the path on this hostname.
 *
 * The server seeds the first paint so the title banner is in the initial HTML.
 * Soft navigations remount via a path key. Redirect responses still move the
 * visitor with router.replace. Drafts and a disabled PAGES module stay not found.
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
  websitePathFromRedirect,
} from "@uog/ui";
import type { PublicPageDocument, PublicSiteContext } from "@uog/ui";
import { usePublicSiteBranding } from "@uog/ui";

export type PublicPageSeed = {
  status: number;
  body: unknown;
  location?: string | null;
} | null;

function pageFromSeed(
  seed: PublicPageSeed,
  site: PublicSiteContext,
): PublicPageDocument | null {
  if (!seed || site.id === null || !site.modules.pages) return null;
  if (seed.status === 308 || seed.status === 301 || seed.status === 302 || seed.status === 307) {
    return null;
  }
  const pageDocument = pageFromResponse(seed.status, seed.body);
  return pageDocument && sameSite(pageDocument.site, site.id) ? pageDocument : null;
}

export function PublicPathPage({
  segments,
  initialPayload,
}: {
  segments: string[];
  /**
   * Server-fetched page response. `undefined` means no server seed (client must
   * fetch). `null` means the server already tried and found nothing.
   */
  initialPayload?: PublicPageSeed;
}) {
  const router = useRouter();
  const site = usePublicSiteBranding();
  const path = safePagePath(segments);
  const serverProvided = initialPayload !== undefined;
  const [page, setPage] = useState<PublicPageDocument | null>(() =>
    serverProvided ? pageFromSeed(initialPayload, site) : null,
  );
  const [ready, setReady] = useState(serverProvided);

  useEffect(() => {
    if (!path) {
      setPage(null);
      setReady(true);
      return;
    }
    if (site.id === null || !site.modules.pages) {
      setPage(null);
      setReady(true);
      return;
    }

    if (
      serverProvided &&
      initialPayload &&
      (initialPayload.status === 308 ||
        initialPayload.status === 301 ||
        initialPayload.status === 302 ||
        initialPayload.status === 307)
    ) {
      const next = websitePathFromRedirect(initialPayload.location ?? null);
      if (next && next !== path) {
        router.replace(next);
        return;
      }
    }

    const seededPage = serverProvided ? pageFromSeed(initialPayload ?? null, site) : null;
    if (serverProvided) {
      setPage(seededPage);
      setReady(true);
      if (seededPage) applyMetadata(site, seededPage);

      let cancelled = false;
      const refresh = () => {
        if (document.visibilityState === "hidden") return;
        void fetch(`/api/v1/site-context/pages${path}/`, publicFetchInit())
          .then(async (response) => {
            if (cancelled) return;
            if (response.status === 308 || response.status === 301 || response.status === 302 || response.status === 307) {
              const next = websitePathFromRedirect(response.headers.get("Location"));
              if (next && next !== path) router.replace(next);
              return;
            }
            const body = response.ok ? await response.json().catch(() => null) : null;
            const pageDocument = pageFromResponse(response.status, body);
            const visible = pageDocument && sameSite(pageDocument.site, site.id) ? pageDocument : null;
            applyMetadata(site, visible);
            setPage(visible);
          })
          .catch(() => {
            /* keep the seeded page visible */
          });
      };
      window.addEventListener("focus", refresh);
      document.addEventListener("visibilitychange", refresh);
      return () => {
        cancelled = true;
        window.removeEventListener("focus", refresh);
        document.removeEventListener("visibilitychange", refresh);
      };
    }

    let cancelled = false;
    setReady(false);
    fetch(`/api/v1/site-context/pages${path}/`, publicFetchInit())
      .then(async (response) => {
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
        const visible = pageDocument && sameSite(pageDocument.site, site.id) ? pageDocument : null;
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
  }, [path, router, site, serverProvided, initialPayload]);

  if (!ready) {
    return (
      <Typography role="status" data-page-loading="">
        Loading published page…
      </Typography>
    );
  }
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
