"use client";

/**
 * Full-page Page create/edit screen (WordPress-style, not a modal).
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { validateVisualLayout } from "@uog/types";
import type { VisualLayout } from "@uog/types";
import { ApiError } from "@uog/api-client";
import { PublicPageView, useToast } from "@uog/ui";
import type { PublicPageDocument } from "@uog/ui";
import { useRouter } from "next/navigation";

import {
  MediaBlockEditor,
  createEmptyGalleryBlock,
  createEmptyImageBlock,
  createEmptySliderBlock,
  parseMediaBlock,
  type MediaBlockValue,
} from "@/sites/content-media-builder";
import { MediaPickerDialog, type MediaPickerResult } from "@/sites/media-picker";
import { imageRefForAsset } from "@/sites/site-image-field";
import {
  createSitePage,
  getSitePage,
  loadSitePages,
  updateSitePage,
} from "@/app/sites/page-actions";
import type {
  SitePageBlock,
  SitePageRecord,
} from "@/app/sites/page-actions";
import { unwrap } from "@/organizations/contract";
import { APP_BASE_PATH } from "@/base-path";

export interface PageLanguages {
  defaultLanguage: string;
  enabled: readonly string[];
}

interface PageForm {
  title: string;
  slug: string;
  parent: string;
  locale: string;
  visibility: SitePageRecord["visibility"];
  metadata: string;
  seoTitle: string;
  seoDescription: string;
  seoExtra: string;
  blocks: string[];
}

const PERMISSIONS = {
  view: "content.pages.view",
  create: "content.pages.create",
  update: "content.pages.update",
} as const;

function seoPreview(seo: Record<string, unknown> | undefined): PublicPageDocument["seo"] {
  return {
    title: typeof seo?.meta_title === "string" ? seo.meta_title : "",
    description: typeof seo?.meta_description === "string" ? seo.meta_description : "",
  };
}

function emptyForm(locale = "en"): PageForm {
  return {
    title: "", slug: "", parent: "", locale, visibility: "PUBLIC",
    metadata: "{}", seoTitle: "", seoDescription: "", seoExtra: "{}",
    blocks: [],
  };
}

function slugFromTitle(title: string): string {
  return title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function formFromRecord(current: SitePageRecord, fallbackLocale: string): PageForm {
  const seo = { ...(current.seo ?? {}) };
  const metaTitle = seo.meta_title;
  const metaDescription = seo.meta_description;
  delete seo.meta_title;
  delete seo.meta_description;
  return {
    title: current.title,
    slug: current.slug,
    parent: current.parent ?? "",
    locale: current.locale || fallbackLocale,
    visibility: current.visibility,
    metadata: JSON.stringify(current.metadata ?? {}, null, 2),
    seoTitle: typeof metaTitle === "string" ? metaTitle : "",
    seoDescription: typeof metaDescription === "string" ? metaDescription : "",
    seoExtra: JSON.stringify(seo, null, 2),
    blocks: (current.blocks ?? []).map((block) => JSON.stringify(block, null, 2)),
  };
}

function blockInputs(form: PageForm): SitePageBlock[] {
  return form.blocks.map((raw) => JSON.parse(raw) as SitePageBlock);
}

function metadataInput(form: PageForm): Record<string, unknown> {
  const value = jsonObject(form.metadata, "Metadata");
  if (Object.hasOwn(value, "visual_layout")) {
    const result = validateVisualLayout(value.visual_layout);
    if (!result.ok) throw new Error(Object.entries(result.errors).map(([path, messages]) => `${path}: ${messages.join(" ")}`).join("\n"));
    value.visual_layout = result.value;
  }
  return value;
}

function jsonObject(source: string, label: string): Record<string, unknown> {
  const value: unknown = JSON.parse(source);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function seoInput(form: PageForm): Record<string, unknown> {
  const seo = jsonObject(form.seoExtra, "Additional SEO");
  const title = form.seoTitle.trim();
  const description = form.seoDescription.trim();
  if (title) seo.meta_title = title;
  else delete seo.meta_title;
  if (description) seo.meta_description = description;
  else delete seo.meta_description;
  return seo;
}

function formSyntaxError(form: PageForm): string | null {
  try {
    metadataInput(form);
    seoInput(form);
    blockInputs(form);
  } catch (error) {
    return error instanceof Error ? error.message : "Correct the JSON fields before saving.";
  }
  return null;
}

function localeChoicesFor(languages: PageLanguages | undefined): string[] | null {
  const enabled = (languages?.enabled ?? []).map((code) => code.trim()).filter(Boolean);
  const unique = [...new Set(enabled)];
  return unique.length > 0 ? unique : null;
}

function defaultLocaleFor(languages: PageLanguages | undefined): string {
  const choices = localeChoicesFor(languages);
  const preferred = languages?.defaultLanguage.trim() ?? "";
  if (choices && preferred && choices.includes(preferred)) return preferred;
  return choices?.[0] ?? "en";
}

export function SitePageEditor({
  siteId,
  pagesEnabled,
  permissions = [],
  languages,
  mode,
  pageId,
}: {
  siteId: number;
  pagesEnabled: boolean | null;
  permissions?: readonly string[];
  languages?: PageLanguages;
  mode: "create" | "edit";
  pageId?: string;
}) {
  return (
    <SitePageEditorContent
      key={`${siteId}-${mode}-${pageId ?? "new"}`}
      siteId={siteId}
      pagesEnabled={pagesEnabled}
      permissions={permissions}
      languages={languages}
      mode={mode}
      pageId={pageId}
    />
  );
}

function SitePageEditorContent({
  siteId,
  pagesEnabled,
  permissions,
  languages,
  mode,
  pageId,
}: {
  siteId: number;
  pagesEnabled: boolean | null;
  permissions: readonly string[];
  languages?: PageLanguages;
  mode: "create" | "edit";
  pageId?: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const listHref = `/sites/${siteId}/admin/pages`;
  const defaultLocale = defaultLocaleFor(languages);
  const localeChoices = localeChoicesFor(languages);
  const canCreate = permissions.includes(PERMISSIONS.create);
  const canEdit = permissions.includes(PERMISSIONS.update);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const mediaInvokeRef = useRef<HTMLButtonElement | null>(null);
  const [activePage, setActivePage] = useState<SitePageRecord | null>(null);
  const [form, setForm] = useState<PageForm>(() => emptyForm(defaultLocale));
  const [saving, setSaving] = useState(false);
  const [loadingPage, setLoadingPage] = useState(mode === "edit");
  const [loadError, setLoadError] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [dialogConflict, setDialogConflict] = useState(false);
  const [showDraftPreview, setShowDraftPreview] = useState(false);
  const [parentPages, setParentPages] = useState<SitePageRecord[]>([]);
  const [parentsReady, setParentsReady] = useState(false);
  const enabled = pagesEnabled === true && !saving && !loadingPage;
  const titleLabel = mode === "create"
    ? "Create Page"
    : activePage?.draft_of
      ? "Edit draft of published Page"
      : "Edit Page";

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const results: SitePageRecord[] = [];
        let pageNumber = 1;
        let hasNext = true;
        while (hasNext && pageNumber <= 100) {
          const response = unwrap(await loadSitePages(siteId, { page: pageNumber, page_size: 100, ordering: "title" }));
          results.push(...response.results.filter((row) => row.site === siteId));
          hasNext = response.next !== null;
          pageNumber += 1;
        }
        if (!cancelled) setParentPages(results);
      } catch {
        if (!cancelled) setParentPages([]);
      } finally {
        if (!cancelled) setParentsReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [siteId]);

  useEffect(() => {
    if (mode === "create") {
      setForm(emptyForm(defaultLocale));
      setActivePage(null);
      setLoadingPage(false);
      return;
    }
    if (!pageId || !canEdit || pagesEnabled !== true) {
      setLoadError(pagesEnabled === false
        ? "Pages are off for this Site."
        : "You do not have permission to edit Pages for this Site.");
      setLoadingPage(false);
      return;
    }
    let cancelled = false;
    setLoadingPage(true);
    setLoadError("");
    void (async () => {
      try {
        const current = unwrap(await getSitePage(siteId, pageId));
        if (cancelled) return;
        setActivePage(current);
        setForm(formFromRecord(current, defaultLocale));
      } catch (cause) {
        if (!cancelled) setLoadError(cause instanceof Error ? cause.message : "The Page could not be loaded.");
      } finally {
        if (!cancelled) setLoadingPage(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mode, pageId, siteId, canEdit, pagesEnabled, defaultLocale]);

  function leaveEditor() {
    if (saving) return;
    const dirty = mode === "create"
      ? JSON.stringify(form) !== JSON.stringify(emptyForm(defaultLocale))
      : activePage !== null && JSON.stringify(form) !== JSON.stringify(formFromRecord(activePage, defaultLocale));
    if (!dirty || window.confirm("Discard your unsaved Page changes?")) {
      router.push(listHref);
    }
  }

  async function savePage() {
    if (!enabled || (mode === "create" ? !canCreate : !canEdit)) return;
    setSaving(true);
    setDialogError("");
    setDialogConflict(false);
    setShowDraftPreview(false);
    try {
      if (mode === "create") {
        unwrap(await createSitePage(siteId, {
          title: form.title.trim(),
          slug: form.slug.trim(),
          parent: form.parent || null,
          locale: form.locale.trim(),
          visibility: form.visibility,
          metadata: metadataInput(form),
          seo: seoInput(form),
          blocks: blockInputs(form),
        }));
        toast.success("Page created.");
      } else if (activePage?.etag) {
        unwrap(await updateSitePage(siteId, activePage.id, activePage.etag, {
          title: form.title.trim(),
          slug: activePage.draft_of ? activePage.slug : form.slug.trim(),
          parent: activePage.draft_of ? null : form.parent || null,
          visibility: form.visibility,
          metadata: metadataInput(form),
          seo: seoInput(form),
          blocks: blockInputs(form),
        }));
        toast.success("Page updated.");
      } else {
        throw new Error("The Page revision is unavailable. Close and reopen the editor.");
      }
      router.push(listHref);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setDialogConflict(true);
        setDialogError(`${cause.message} Your edits are still here. Reload the latest version to continue.`);
      } else {
        setDialogError(cause instanceof Error ? cause.message : "The Page could not be saved.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function reloadLatestAfterConflict() {
    if (!activePage) return;
    setSaving(true);
    try {
      const current = unwrap(await getSitePage(siteId, activePage.id));
      setActivePage(current);
      setForm(formFromRecord(current, defaultLocale));
      setDialogConflict(false);
      setDialogError("");
    } catch (cause) {
      setDialogError(cause instanceof Error ? cause.message : "The latest Page could not be loaded.");
    } finally {
      setSaving(false);
    }
  }

  function moveBlock(index: number, offset: number) {
    setForm((current) => {
      const next = [...current.blocks];
      const target = index + offset;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, blocks: next };
    });
  }

  if (mode === "create" && (!canCreate || pagesEnabled !== true)) {
    return (
      <Paper variant="outlined" sx={{ borderRadius: 3, p: { xs: 2, sm: 3 } }}>
        <Alert severity="warning">
          {pagesEnabled === false
            ? "Pages are off for this Site. Create, edit and workflow changes are blocked."
            : "You do not have permission to create Pages for this Site."}
        </Alert>
        <Button component={Link} href={listHref} sx={{ mt: 2 }}>Back to Pages</Button>
      </Paper>
    );
  }

  if (loadingPage || (mode === "create" && !parentsReady)) {
    return <Typography role="status">Loading page editor…</Typography>;
  }

  if (loadError) {
    return (
      <Paper variant="outlined" sx={{ borderRadius: 3, p: { xs: 2, sm: 3 } }}>
        <Alert severity="error" role="alert">{loadError}</Alert>
        <Button component={Link} href={listHref} sx={{ mt: 2 }}>Back to Pages</Button>
      </Paper>
    );
  }

  return (
    <Paper
      component="section"
      variant="outlined"
      aria-labelledby="page-editor-title"
      sx={{ borderRadius: 3, p: { xs: 2, sm: 3 }, display: "flex", flexDirection: "column", gap: 2 }}
    >
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
        <Box>
          <Typography id="page-editor-title" variant="h1" sx={{ fontSize: "1.5rem", fontWeight: 700 }}>
            {titleLabel}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Create or revise this Page on a full editor screen.
          </Typography>
        </Box>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
          <Button onClick={leaveEditor} disabled={saving}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => void savePage()}
            disabled={
              !enabled ||
              !form.title.trim() ||
              !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug.trim()) ||
              !form.locale.trim() ||
              form.blocks.some((block) => { try { JSON.parse(block); return false; } catch { return true; } }) ||
              (() => { try { metadataInput(form); return false; } catch { return true; } })()
              || (() => { try { seoInput(form); return false; } catch { return true; } })()
            }
          >
            {saving ? "Saving…" : mode === "create" ? "Create Page" : "Save changes"}
          </Button>
        </Box>
      </Box>

      {dialogError ? (
        <Alert severity={dialogConflict ? "warning" : "error"} role="alert" action={dialogConflict ? <Button color="inherit" size="small" onClick={() => void reloadLatestAfterConflict()}>Reload latest</Button> : undefined}>
          {dialogError}
        </Alert>
      ) : null}
      {formSyntaxError(form) ? <Alert severity="error" role="alert">{formSyntaxError(form)}</Alert> : null}
      <TextField
        label="Title"
        value={form.title}
        onChange={(event) => setForm((current) => ({
          ...current,
          title: event.target.value,
          slug: mode === "create" && current.slug === slugFromTitle(current.title)
            ? slugFromTitle(event.target.value)
            : current.slug,
        }))}
        disabled={!enabled}
        autoFocus
        required
      />
      <TextField
        label="Slug"
        value={form.slug}
        onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))}
        disabled={!enabled || Boolean(activePage?.draft_of)}
        required
        helperText={activePage?.draft_of
          ? "Publication keeps the live Page route. This draft uses an internal slug."
          : mode === "create"
            ? "Filled from the title until you edit it. Use lowercase letters, numbers and hyphens."
            : "Use lowercase letters, numbers and hyphens."}
      />
      <TextField
        select
        label="Parent Page"
        value={form.parent}
        disabled={!enabled || Boolean(activePage?.draft_of)}
        helperText="Only Pages from this Site are available. Route history is preserved when a Page moves."
        onChange={(event) => setForm((current) => ({ ...current, parent: event.target.value }))}
      >
        <MenuItem value="">No parent (top level)</MenuItem>
        {parentPages.filter((row) => row.id !== activePage?.id && !(activePage && row.path.startsWith(`${activePage.path}/`))).map((row) => (
          <MenuItem key={row.id} value={row.id}>{row.title} — {row.path}</MenuItem>
        ))}
      </TextField>
      {localeChoices ? (
        <TextField
          select
          label="Locale"
          value={form.locale}
          onChange={(event) => setForm((current) => ({ ...current, locale: event.target.value }))}
          disabled={mode === "edit"}
          required
          helperText={mode === "edit"
            ? "Locale is fixed when the Page is created."
            : "Choose one of this Site's enabled languages."}
        >
          {(localeChoices.includes(form.locale) ? localeChoices : [form.locale, ...localeChoices]).map((code) => (
            <MenuItem key={code} value={code}>{code}</MenuItem>
          ))}
        </TextField>
      ) : (
        <TextField label="Locale" value={form.locale} onChange={(event) => setForm((current) => ({ ...current, locale: event.target.value }))} disabled={mode === "edit"} required helperText={mode === "edit" ? "Locale is fixed when the Page is created." : "Use a language this Site enables, such as en-us."} />
      )}
      <TextField select label="Visibility" value={form.visibility} onChange={(event) => setForm((current) => ({ ...current, visibility: event.target.value as SitePageRecord["visibility"] }))}>
        <MenuItem value="PUBLIC">Public</MenuItem><MenuItem value="UNLISTED">Unlisted</MenuItem><MenuItem value="HIDDEN">Hidden</MenuItem>
      </TextField>
      <TextField
        label="SEO title"
        value={form.seoTitle}
        onChange={(event) => setForm((current) => ({ ...current, seoTitle: event.target.value }))}
        helperText="Search result title. Leave blank to use the Page title."
      />
      <TextField
        label="Meta description"
        value={form.seoDescription}
        onChange={(event) => setForm((current) => ({ ...current, seoDescription: event.target.value }))}
        multiline
        minRows={2}
        helperText="Short summary shown in search results."
      />
      <Accordion disableGutters elevation={0} sx={{ border: 1, borderColor: "divider", "&:before": { display: "none" } }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>Advanced</AccordionSummary>
        <AccordionDetails sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <TextField label="Metadata (JSON object)" value={form.metadata} onChange={(event) => setForm((current) => ({ ...current, metadata: event.target.value }))} multiline minRows={3} helperText="Technical page metadata. Leave this as {} for an ordinary Page." />
          <TextField label="Additional SEO (JSON object)" value={form.seoExtra} onChange={(event) => setForm((current) => ({ ...current, seoExtra: event.target.value }))} multiline minRows={3} helperText="Other search settings. SEO title and description are edited above." />
        </AccordionDetails>
      </Accordion>
      <Box component="section" aria-label="Content blocks" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <Typography variant="subtitle2">Content blocks</Typography>
        {permissions.includes("content.media.view") ? (
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            <Button
              ref={mediaInvokeRef}
              onClick={() => setMediaPickerOpen(true)}
              aria-haspopup="dialog"
            >
              Choose uploaded image
            </Button>
            <Button onClick={() => setForm((current) => ({ ...current, blocks: [...current.blocks, JSON.stringify(createEmptySliderBlock(), null, 2)] }))}>Add slider</Button>
            <Button onClick={() => setForm((current) => ({ ...current, blocks: [...current.blocks, JSON.stringify(createEmptyGalleryBlock(), null, 2)] }))}>Add gallery</Button>
          </Box>
        ) : null}
        <MediaPickerDialog
          open={mediaPickerOpen}
          siteId={siteId}
          returnFocusRef={mediaInvokeRef}
          canUpload={permissions.includes("content.media.upload")}
          onCancel={() => setMediaPickerOpen(false)}
          onConfirm={(result: MediaPickerResult) => {
            const block = {
              ...createEmptyImageBlock(siteId),
              ref: imageRefForAsset(siteId, result.assetId),
              alt: result.altText || "Describe this image",
            };
            setForm((current) => ({ ...current, blocks: [...current.blocks, JSON.stringify(block, null, 2)] }));
            setMediaPickerOpen(false);
          }}
        />

        {form.blocks.map((block, index) => {
          let mediaBlock: MediaBlockValue | null = null;
          try { mediaBlock = parseMediaBlock(JSON.parse(block)); } catch { mediaBlock = null; }
          return (
            <Paper key={`block-${index}`} variant="outlined" sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
              <Typography variant="caption">Block {index + 1}{mediaBlock ? ` · ${mediaBlock.type}` : " · edit structured JSON"}</Typography>
              {mediaBlock && permissions.includes("content.media.view") ? (
                <MediaBlockEditor
                  siteId={siteId}
                  value={mediaBlock}
                  canUpload={permissions.includes("content.media.upload")}
                  onChange={(next) => setForm((current) => ({
                    ...current,
                    blocks: current.blocks.map((item, itemIndex) => itemIndex === index ? JSON.stringify(next, null, 2) : item),
                  }))}
                />
              ) : null}
              <TextField
                label={`Block ${index + 1} JSON`}
                value={block}
                onChange={(event) => setForm((current) => ({ ...current, blocks: current.blocks.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))}
                multiline minRows={3} fullWidth inputProps={{ "aria-label": `Block ${index + 1} JSON` }}
              />
              <Box sx={{ display: "flex", gap: 1 }}>
                <Button aria-label={`Move block ${index + 1} up`} disabled={index === 0} onClick={() => moveBlock(index, -1)}>Move up</Button>
                <Button aria-label={`Move block ${index + 1} down`} disabled={index === form.blocks.length - 1} onClick={() => moveBlock(index, 1)}>Move down</Button>
                <Button aria-label={`Remove block ${index + 1}`} color="error" onClick={() => setForm((current) => ({ ...current, blocks: current.blocks.filter((_, itemIndex) => itemIndex !== index) }))}>Remove</Button>
              </Box>
            </Paper>
          );
        })}
        <Button onClick={() => setForm((current) => ({ ...current, blocks: [...current.blocks, '{"type":"heading","level":2,"text":"New heading"}'] }))}>Add heading block</Button>
        <Button onClick={() => setForm((current) => ({ ...current, blocks: [...current.blocks, '{"type":"paragraph","html":"<p>New paragraph</p>"}'] }))}>Add paragraph block</Button>
        <Button onClick={() => setForm((current) => ({ ...current, blocks: [...current.blocks, JSON.stringify(createEmptyImageBlock(siteId), null, 2)] }))}>Add image block</Button>
        <Button onClick={() => setForm((current) => ({ ...current, blocks: [...current.blocks, '{"type":"button","label":"Learn more","href":"/"}'] }))}>Add button block</Button>
        <Button onClick={() => setForm((current) => ({ ...current, blocks: [...current.blocks, '{"type":"list","style":"unordered","items":["First item"]}'] }))}>Add list block</Button>
        <Button onClick={() => setForm((current) => ({ ...current, blocks: [...current.blocks, '{"type":"section","heading":"New section","children":[{"type":"paragraph","html":"<p>Section content</p>"}]}'] }))}>Add section block</Button>
      </Box>
      <Button onClick={() => setShowDraftPreview((value) => !value)} aria-expanded={showDraftPreview}>
        {showDraftPreview ? "Hide draft preview" : "Preview draft"}
      </Button>
      {showDraftPreview ? (
        <Paper variant="outlined" sx={{ p: 2 }} aria-label="Unpublished Page preview">
          <Typography variant="overline">Private draft preview</Typography>
          {(() => {
            try {
              return (
                <PublicPageView
                  privateMediaBase={`${APP_BASE_PATH}/sites/${siteId}/media`}
                  page={{
                    title: form.title || "Untitled Page",
                    path: activePage?.path ?? `/${form.slug}`,
                    site: siteId,
                    blocks: blockInputs(form),
                    ...(metadataInput(form).visual_layout ? {visual_layout:metadataInput(form).visual_layout as VisualLayout} : {}),
                    seo: seoPreview(seoInput(form)),
                  }}
                />
              );
            } catch {
              return <Alert severity="error">Fix block JSON errors to preview this draft.</Alert>;
            }
          })()}
        </Paper>
      ) : null}
    </Paper>
  );
}
