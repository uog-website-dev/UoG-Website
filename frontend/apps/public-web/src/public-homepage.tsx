"use client";

/** Host-resolved published homepage. Operational diagnostics belong in administration. */
import { useEffect, useState } from "react";
import { Alert, Box, Button, CircularProgress, Typography } from "@mui/material";
import {
  pageFromResponse,
  pageMetadata,
  PublicPageView,
  publicFetchInit,
  sameSite,
  usePublicSiteBranding,
} from "@uog/ui";
import type { PublicPageDocument } from "@uog/ui";
import type { PublicPageSeed } from "./public-page";

export function PublicHomepage({
  initialPayload,
}: {
  /**
   * Server-fetched homepage response. `undefined` means no server seed.
   * `null` means the server already tried and found nothing.
   */
  initialPayload?: PublicPageSeed;
}) {
  const site = usePublicSiteBranding();
  const serverProvided = initialPayload !== undefined;
  const [homepage, setHomepage] = useState<PublicPageDocument | null>(() => {
    if (!serverProvided || !initialPayload || !site.id || !site.modules.pages) return null;
    const document = pageFromResponse(initialPayload.status, initialPayload.body);
    return document && sameSite(document.site, site.id) ? document : null;
  });
  const [loading, setLoading] = useState(!serverProvided && Boolean(site.id && site.modules.pages));
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    if (!site.id || !site.modules.pages) {
      setHomepage(null);
      setLoading(false);
      return () => controller.abort();
    }

    if (serverProvided) {
      const seeded = initialPayload
        ? (() => {
            const document = pageFromResponse(initialPayload.status, initialPayload.body);
            return document && sameSite(document.site, site.id) ? document : null;
          })()
        : null;
      setHomepage(seeded);
      setLoading(false);
      const refresh = () => {
        if (document.visibilityState === "hidden") return;
        void fetch("/api/v1/site-context/homepage/", { ...publicFetchInit(), signal: controller.signal })
          .then(async (response) => {
            if (!response.ok && response.status !== 404) throw new Error("The homepage is temporarily unavailable.");
            const body = response.ok ? await response.json() : null;
            if (!controller.signal.aborted) setHomepage(pageFromResponse(response.status, body));
          })
          .catch(() => {
            /* keep seeded homepage */
          });
      };
      window.addEventListener("focus", refresh);
      document.addEventListener("visibilitychange", refresh);
      return () => {
        controller.abort();
        window.removeEventListener("focus", refresh);
        document.removeEventListener("visibilitychange", refresh);
      };
    }

    setHomepage(null);
    setLoading(true);
    fetch("/api/v1/site-context/homepage/", { ...publicFetchInit(), signal: controller.signal })
      .then(async (response) => {
        if (!response.ok && response.status !== 404) throw new Error("The homepage is temporarily unavailable.");
        const body = response.ok ? await response.json() : null;
        if (!controller.signal.aborted) setHomepage(pageFromResponse(response.status, body));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("The homepage is temporarily unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [site.id, site.modules.pages, serverProvided, initialPayload]);

  const visible = site.modules.pages && homepage && sameSite(homepage.site, site.id) ? homepage : null;
  useEffect(() => {
    if (!site.id || !visible) return;
    const metadata = pageMetadata(site, visible);
    document.title = metadata.title;
    let description = document.querySelector('meta[name="description"]');
    if (!description) {
      description = document.createElement("meta");
      description.setAttribute("name", "description");
      document.head.appendChild(description);
    }
    description.setAttribute("content", metadata.description);
  }, [site, visible]);

  return (
    <Box sx={{ minWidth: 0, width: "100%", overflowWrap: "anywhere" }}>
      {!site.id ? (
        <Alert severity="warning">No Site is configured for this hostname.</Alert>
      ) : loading ? (
        <Box role="status" data-page-loading="" sx={{ display: "flex", alignItems: "center", gap: 2, py: 4 }}>
          <CircularProgress size={24} />
          <Typography>Loading homepage...</Typography>
        </Box>
      ) : error ? (
        <Alert severity="warning" action={<Button onClick={() => location.reload()}>Retry</Button>}>
          {error}
        </Alert>
      ) : (
        <PublicPageView page={visible} />
      )}
    </Box>
  );
}
