"use client";

/**
 * Page authoring for one Site: draft, preview, review and publication.
 *
 * The Site id is a prop. Preview uses the same safe renderer as the public
 * site, so a stored script or javascript: URL is not mounted as markup.
 */
import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { PublicPageView, useAsync, useToast } from "@uog/ui";
import type { PublicPageDocument } from "@uog/ui";

import {
  createSitePage,
  loadSitePages,
  setSiteHomepage,
  transitionSitePage,
  updateSitePage,
} from "@/app/sites/page-actions";
import type { SitePageRecord } from "@/app/sites/page-actions";
import { unwrap } from "@/organizations/contract";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function previewOf(page: SitePageRecord): PublicPageDocument {
  return {
    title: page.title,
    path: page.path,
    blocks: page.blocks as PublicPageDocument["blocks"],
  };
}

export function SitePagesPanel({
  siteId,
  pagesEnabled,
}: {
  siteId: number;
  pagesEnabled: boolean | null;
}) {
  const toast = useToast();
  const pages = useAsync(() => loadSitePages(siteId).then(unwrap), [siteId]);
  const [title, setTitle] = useState("Admissions");
  const [slug, setSlug] = useState("admissions");
  const [text, setText] = useState("Applications are open.");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const enabled = pagesEnabled === true && !busy;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      pages.reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "The page could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const rows = (pages.data ?? []).filter((page) => page.site === siteId);

  return (
    <Paper variant="outlined" sx={{ borderRadius: 3, p: { xs: 2, sm: 3 }, display: "flex", flexDirection: "column", gap: 2 }}>
      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Pages</Typography>
        <Typography variant="body2" color="text.secondary">
          Create a draft, preview it, and move it through review. The public
          site shows a published page only for the hostname that resolves to
          this Site.
        </Typography>
      </Box>
      {pagesEnabled === null ? (
        <Typography variant="body2" color="text.secondary" aria-live="polite">Checking the PAGES module…</Typography>
      ) : null}
      {pages.error ? <Alert severity="error">{pages.error.message}</Alert> : null}
      {pagesEnabled === false ? (
        <Alert severity="warning">
          Pages are off for this Site. Changes are blocked and the public
          website does not serve pages. Existing pages stay in place.
        </Alert>
      ) : null}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, maxWidth: 520 }}>
        <TextField label="Title" value={title} onChange={(event) => setTitle(event.target.value)} disabled={!enabled} />
        <TextField label="Slug" value={slug} onChange={(event) => setSlug(event.target.value)} disabled={!enabled} />
        <TextField label="Body" value={text} onChange={(event) => setText(event.target.value)} disabled={!enabled} multiline minRows={2} />
        <Button
          variant="contained"
          disabled={!enabled || !title.trim() || !SLUG.test(slug)}
          onClick={() => run(async () => {
            unwrap(await createSitePage(siteId, { title: title.trim(), slug, text }));
          })}
        >
          Create page
        </Button>
      </Box>
      <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        {rows.map((page) => (
          <Box component="li" key={page.id} sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
              <Typography sx={{ fontWeight: 700 }}>{page.title}</Typography>
              <Chip size="small" label={page.status} variant="outlined" />
              {page.is_homepage ? <Chip size="small" label="Homepage" color="primary" variant="outlined" /> : null}
            </Box>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              {page.status === "DRAFT" || page.status === "UNPUBLISHED" ? (
                <Button
                  variant="outlined"
                  disabled={!enabled}
                  onClick={() => run(async () => {
                    unwrap(await updateSitePage(siteId, page.id, page.etag, { title: `${page.title} updated` }));
                  })}
                >
                  Save {page.title}
                </Button>
              ) : null}
              {page.status === "DRAFT" ? (
                <Button
                  variant="outlined"
                  disabled={!enabled}
                  onClick={() => run(async () => {
                    unwrap(await transitionSitePage(siteId, page.id, "submit"));
                  })}
                >
                  Submit {page.title} for review
                </Button>
              ) : null}
              {page.status === "IN_REVIEW" ? (
                <>
                  <Button variant="outlined" disabled={!enabled} onClick={() => run(async () => {
                    unwrap(await transitionSitePage(siteId, page.id, "approve"));
                  })}>
                    Approve {page.title}
                  </Button>
                  <Button variant="outlined" disabled={!enabled || !comment.trim()} onClick={() => run(async () => {
                    unwrap(await transitionSitePage(siteId, page.id, "reject", comment.trim()));
                  })}>
                    Reject {page.title}
                  </Button>
                </>
              ) : null}
              {page.status === "APPROVED" ? (
                <Button variant="outlined" disabled={!enabled} onClick={() => run(async () => {
                  unwrap(await transitionSitePage(siteId, page.id, "publish"));
                })}>
                  Publish {page.title}
                </Button>
              ) : null}
              {page.status === "PUBLISHED" ? (
                <Button variant="outlined" disabled={!enabled} onClick={() => run(async () => {
                  unwrap(await transitionSitePage(siteId, page.id, "unpublish"));
                })}>
                  Unpublish {page.title}
                </Button>
              ) : null}
              {(page.status === "DRAFT" || page.status === "UNPUBLISHED") && !page.is_homepage ? (
                <Button variant="outlined" disabled={!enabled} onClick={() => run(async () => {
                  unwrap(await setSiteHomepage(siteId, page.id));
                })}>
                  Set {page.title} as homepage
                </Button>
              ) : null}
            </Box>
            <Box aria-label={`Preview ${page.title}`} sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 2 }}>
              <PublicPageView page={{ ...previewOf(page), title: page.title }} />
            </Box>
          </Box>
        ))}
      </Box>
      {rows.some((page) => page.status === "IN_REVIEW") ? (
        <TextField
          label="Review comment"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          disabled={!enabled}
        />
      ) : null}
    </Paper>
  );
}
