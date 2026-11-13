"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { PublicPageView, pageFromResponse } from "@uog/ui";
import { getSitePagePreview } from "@/app/sites/page-actions";
import type { SitePagePreview } from "@/app/sites/page-actions";
import { APP_BASE_PATH } from "@/base-path";
import { unwrap } from "@/organizations/contract";
import { SiteSection, useSiteAdmin } from "@/sites/site-admin-frame";

/**
 * Full-page private preview for one Page (WordPress-style new-tab target).
 * Uses the Page id in the path and loads the saved revision snapshot.
 */
export default function PagePreviewPage() {
  const { site, permissions } = useSiteAdmin();
  const { pageId } = useParams<{ pageId: string }>();
  const query=useSearchParams();
  const requested=query.get("revision");
  const revision=requested && /^[1-9][0-9]*$/.test(requested) && Number.isSafeInteger(Number(requested)) ? Number(requested) : undefined;
  const [preview, setPreview] = useState<SitePagePreview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const canView = permissions.includes("content.pages.view");

  useEffect(() => {
    let cancelled = false;
    if (!canView || !pageId) {
      setLoading(false);
      setError("You do not have permission to preview this Page.");
      return;
    }
    setLoading(true);
    setError("");
    setPreview(null);
    void (async () => {
      try {
        if(requested && revision===undefined)throw new Error("This preview revision is invalid.");
        const result = unwrap(await getSitePagePreview(site.id, pageId, revision));
        if(result.page.site!==site.id)throw new Error("The preview belongs to another Site.");
        if (!cancelled) setPreview(result);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Preview could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [canView, pageId, site.id, requested, revision]);

  return (
    <SiteSection sectionKey="pages">
      <Box sx={{position:"fixed",inset:0,zIndex:1201,overflow:"auto",bgcolor:"background.paper",minWidth:0}}>
        <Box sx={{position:"sticky",top:0,zIndex:2,px:2,py:1,bgcolor:"#1c242c",color:"white",display:"flex",gap:1,flexWrap:"wrap",alignItems:"center","& .MuiButton-root":{color:"white"}}}>
          <Typography variant="body2" component="p" sx={{ flex: 1, minWidth: 0 }}>
            {preview?.page.title ?? "Page preview"}
            {preview ? ` · Preview · Revision ${preview.revision_number}` : ""}
          </Typography>
          <Button component={Link} href={`/sites/${site.id}/admin/pages`} size="small">
            Back to Pages
          </Button>
          {pageId ? (
            <Button component={Link} href={`/sites/${site.id}/admin/pages/${pageId}/builder`} size="small">
              Open Visual Builder
            </Button>
          ) : null}
        </Box>
        {loading ? (
          <Box role="status" sx={{ display: "flex", justifyContent: "center", py: 8 }}>
            <CircularProgress size={28} />
          </Box>
        ) : error ? (
          <Alert severity="error">{error}</Alert>
        ) : preview ? (
          <Box
            component="section"
            aria-label="Full page preview"
            sx={{ bgcolor: "background.paper", minHeight: "calc(100dvh - 50px)" }}
          >
            <PublicPageView
              page={pageFromResponse(200, { ...preview.page, id: pageId })}
              privateMediaBase={`${APP_BASE_PATH}/sites/${site.id}/pages/${pageId}/preview-media/${preview.revision_number}`}
            />
          </Box>
        ) : (
          <Alert severity="warning">No preview is available for this Page.</Alert>
        )}
      </Box>
    </SiteSection>
  );
}
