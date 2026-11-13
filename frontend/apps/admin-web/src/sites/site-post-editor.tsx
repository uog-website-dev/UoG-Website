"use client";

/**
 * Full-page Post create/edit screen (WordPress-style, not a modal).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import { APP_BASE_PATH } from "@/base-path";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import OutlinedInput from "@mui/material/OutlinedInput";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { ApiError } from "@uog/api-client";
import {
  ArticleDocumentView, ArticleAssetImage, articlePlainText, normalizeArticleDocument, PublicPageView, useAsync, useToast,
} from "@uog/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  createSiteTaxonomy,
  createSitePost,
  getSitePost,
  loadSiteTaxonomy,
  updateSitePost,
  transitionSitePost,
  openSitePostWorkingDraft,
} from "@/app/sites/post-actions";
import type {
  SitePostRecord,
  SitePostBlock,
  SiteTaxonomyRecord,
} from "@/app/sites/post-actions";
import { unwrap } from "@/organizations/contract";

import { MediaPickerDialog } from "./media-picker";
import { ContentWorkflowButtons, ContentWorkflowDialog } from "./content-workflow";
import type { WorkflowAction } from "./content-workflow";
import { PostRichEditor } from "./post-rich-editor";

const PERMISSIONS = {
  view: "content.posts.view",
  create: "content.posts.create",
  update: "content.posts.update",
} as const;
const EMPTY_TAXONOMY: SiteTaxonomyRecord[] = [];

interface PostForm {
  title: string;
  slug: string;
  excerpt: string;
  blocks: string[];
  html: string;
  legacy: boolean;
  seo: string;
  featured_media: string;
  featured_alt: string;
  categories: string[];
  tags: string[];
}

function emptyForm(): PostForm {
  return {
    title: "", slug: "", excerpt: "", blocks: [], html: "", legacy: false,
    seo: "{}", featured_media: "", featured_alt: "", categories: [], tags: [],
  };
}

function parseObject(source: string, label: string): Record<string, unknown> {
  const value: unknown = JSON.parse(source);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object.`);
  return value as Record<string, unknown>;
}

function parsedBlocks(form: PostForm): SitePostBlock[] {
  return form.blocks.map((block, index) => {
    let value: unknown;
    try { value = JSON.parse(block); } catch { throw new Error(`Block ${index + 1} must contain valid JSON.`); }
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof (value as SitePostBlock).type !== "string") {
      throw new Error(`Block ${index + 1} needs a valid type.`);
    }
    return value as SitePostBlock;
  });
}

function blockText(blocks: SitePostBlock[]): string {
  return blocks.map((block) => [
    block.text, block.heading, block.label, ...(block.items ?? []),
    block.html?.replace(/<[^>]*>/g, " "), block.children ? blockText(block.children) : "",
  ].filter(Boolean).join(" ")).join("\n").replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function slugFromTitle(title: string): string {
  return title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 128);
}

function legacyArticle(blocks: SitePostBlock[]): string | null {
  const output: string[] = [];
  for (const block of blocks) {
    if (block.type === "paragraph") {
      output.push(block.html || `<p>${escapeHtml(block.text || "")}</p>`);
    } else if (block.type === "heading") {
      const level = [2, 3, 4].includes(Number(block.level)) ? Number(block.level) : 2;
      output.push(`<h${level}>${escapeHtml(block.text || "")}</h${level}>`);
    } else if (block.type === "list") {
      const tag = block.style === "ordered" ? "ol" : "ul";
      const items = (block.items || []).map(item => `<li>${escapeHtml(String(item))}</li>`).join("");
      output.push(`<${tag}>${items}</${tag}>`);
    } else if (block.type === "section") {
      const children = legacyArticle(block.children || []);
      if (children === null) return null;
      output.push(block.heading ? `<h2>${escapeHtml(block.heading)}</h2>${children}` : children);
    } else {
      return null;
    }
  }
  return output.join("");
}

function mediaReferenceError(value: string, siteId: number): string {
  if (!value) return "";
  const normalized = value.trim().toLowerCase().replace(/^\/+|\/+$/g, "");
  const parts = normalized.split("/");
  const shared = parts.length >= 2 && parts[0] === "shared";
  const siteScoped = parts.length >= 3 && parts[0] === "sites" && parts[1] === String(siteId);
  if ((!shared && !siteScoped) || parts.some((part) => !/^[a-z0-9][a-z0-9._-]*$/.test(part))) {
    return `Use a media reference under sites/${siteId}/ or shared/. External and other-Site media are not allowed.`;
  }
  return "";
}

/** Keep in sync with backend apps.api.models.RESERVED_POST_SLUGS */
const RESERVED_POST_SLUGS = new Set([
  "new", "edit", "create", "admin", "api", "preview", "feed", "search", "rss", "atom", "index",
]);

function slugError(value: string): string {
  const slug = value.trim();
  if (!slug) return "";
  if (slug.length > 128) return "Use at most 128 characters for the permalink.";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return "Use lowercase letters and numbers separated by single hyphens.";
  }
  if (RESERVED_POST_SLUGS.has(slug)) {
    return `"${slug}" is reserved and cannot be used as a Post permalink.`;
  }
  return "";
}

function blocksError(form: PostForm): string {
  try {
    if (!form.legacy) return articlePlainText(normalizeArticleDocument({schema_version:1, html:form.html}).html) ? "" : "Write the article body.";
    if (!blockText(parsedBlocks(form))) return "Add content to at least one Post block.";
    return "";
  } catch (cause) {
    return cause instanceof Error ? cause.message : "Correct the Post block data.";
  }
}

function seoError(source: string, siteId: number): string {
  try {
    const seo = parseObject(source, "SEO metadata");
    const limits: Record<string, number> = { meta_title: 120, meta_description: 300, og_image_ref: 512 };
    const unknown = Object.keys(seo).filter((key) => !(key in limits));
    if (unknown.length) return `Unsupported SEO key(s): ${unknown.join(", ")}.`;
    for (const [key, value] of Object.entries(seo)) {
      if (value !== null && typeof value !== "string") return `${key} must be text.`;
      if (typeof value === "string" && value.length > limits[key]) return `${key} must be at most ${limits[key]} characters.`;
      if (key === "og_image_ref" && typeof value === "string" && mediaReferenceError(value, siteId)) {
        return "og_image_ref must use a media reference in this Site or the shared scope.";
      }
    }
    return "";
  } catch (cause) {
    return cause instanceof Error ? cause.message : "SEO metadata must be a JSON object.";
  }
}

function apiErrorText(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError && cause.fieldErrors) {
    const fields = Object.entries(cause.fieldErrors)
      .map(([field, messages]) => `${field}: ${messages.join(" ")}`)
      .join(" ");
    return fields || cause.message;
  }
  return cause instanceof Error ? cause.message : fallback;
}

function formFromRecord(current: SitePostRecord): PostForm {
  const converted = legacyArticle(current.blocks ?? []);
  const nextForm: PostForm = {
    html: current.editor_document?.html ?? converted ?? "",
    legacy: !current.editor_document && converted === null,
    title: current.title,
    slug: current.slug,
    excerpt: current.excerpt,
    blocks: current.blocks?.length
      ? current.blocks.map((block) => JSON.stringify(block, null, 2))
      : [JSON.stringify({ type: "paragraph", html: `<p>${escapeHtml(current.content ?? "")}</p>` }, null, 2)],
    seo: JSON.stringify(current.seo ?? {}, null, 2),
    featured_media: current.featured_media ?? "",
    featured_alt: current.featured_alt ?? "",
    categories: current.categories ?? [],
    tags: current.tags ?? [],
  };
  if (!current.editor_document && !current.blocks?.length) {
    nextForm.html = `<p>${escapeHtml(current.content ?? "").replace(/\n/g, "<br>")}</p>`;
  }
  return nextForm;
}

export function SitePostEditor({
  siteId,
  postsEnabled,
  mediaEnabled = false,
  permissions = [],
  mode,
  postId,
}: {
  siteId: number;
  postsEnabled: boolean | null;
  mediaEnabled?: boolean;
  permissions?: readonly string[];
  mode: "create" | "edit";
  postId?: string;
}) {
  return (
    <SitePostEditorContent
      key={`${siteId}-${mode}-${postId ?? "new"}`}
      siteId={siteId}
      postsEnabled={postsEnabled}
      mediaEnabled={mediaEnabled}
      permissions={permissions}
      mode={mode}
      postId={postId}
    />
  );
}

function SitePostEditorContent({
  siteId,
  postsEnabled,
  mediaEnabled,
  permissions,
  mode,
  postId,
}: {
  siteId: number;
  postsEnabled: boolean | null;
  mediaEnabled: boolean;
  permissions: readonly string[];
  mode: "create" | "edit";
  postId?: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const listHref = `/sites/${siteId}/admin/posts`;
  const canUseMedia = mediaEnabled && permissions.includes("content.media.view");
  const canUploadMedia = canUseMedia && permissions.includes("content.media.upload");
  const [featuredPicker, setFeaturedPicker] = useState(false);
  const featuredButton = useRef<HTMLButtonElement>(null);
  const canCreate = permissions.includes(PERMISSIONS.create);
  const canEdit = permissions.includes(PERMISSIONS.update);
  const canRead = permissions.includes(PERMISSIONS.view);
  const [workflowAction,setWorkflowAction] = useState<WorkflowAction | null>(null);
  const [workflowComment,setWorkflowComment] = useState("");
  const [workflowError,setWorkflowError] = useState("");
  const [activePost, setActivePost] = useState<SitePostRecord | null>(null);
  const [form, setForm] = useState<PostForm>(emptyForm);
  const bodyProblem = useMemo(() => blocksError(form), [form]);
  const baseline = useRef("");
  const dirty = JSON.stringify(form) !== baseline.current;
  const [loadingPost, setLoadingPost] = useState(mode === "edit");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [attemptedSave, setAttemptedSave] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [dialogError, setDialogError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [conflict, setConflict] = useState(false);
  const [showDraftPreview, setShowDraftPreview] = useState(false);
  const editorFieldError = [
    ...(fieldErrors.editor_document ?? []),
    ...(fieldErrors["editor_document.html"] ?? []),
    ...(fieldErrors["editor_document.schema_version"] ?? []),
  ].join(" ");
  const slugFieldError = fieldErrors.slug?.join(" ") || slugError(form.slug);
  const categoryFieldError = fieldErrors.categories?.join(" ") ?? "";
  const tagFieldError = fieldErrors.tags?.join(" ") ?? "";
  const metadataEditable = !activePost || activePost.status === "DRAFT" || activePost.status === "UNPUBLISHED";
  const [taxonomyTarget, setTaxonomyTarget] = useState<"categories" | "tags" | null>(null);
  const [taxonomyName, setTaxonomyName] = useState("");
  const [taxonomyCode, setTaxonomyCode] = useState("");
  const [taxonomyDialogError, setTaxonomyDialogError] = useState("");
  const [taxonomySaving, setTaxonomySaving] = useState(false);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (mode === "create") {
      baseline.current = JSON.stringify(emptyForm());
      setForm(emptyForm());
      setActivePost(null);
      setLoadingPost(false);
      return;
    }
    if (!postId || !canRead || postsEnabled !== true) {
      setLoadError(postsEnabled === false
        ? "Posts are disabled for this Site."
        : "You do not have permission to edit Posts for this Site.");
      setLoadingPost(false);
      return;
    }
    let cancelled = false;
    setLoadingPost(true);
    setLoadError("");
    void (async () => {
      try {
        const current = unwrap(await getSitePost(siteId, postId));
        if (cancelled) return;
        const nextForm = formFromRecord(current);
        setActivePost(current);
        baseline.current = JSON.stringify(nextForm);
        setForm(nextForm);
      } catch (cause) {
        if (!cancelled) setLoadError(cause instanceof Error ? cause.message : "The Post could not be loaded.");
      } finally {
        if (!cancelled) setLoadingPost(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mode, postId, siteId, canRead, postsEnabled]);

  const taxonomy = useAsync<{ categories: SiteTaxonomyRecord[]; tags: SiteTaxonomyRecord[] }>(
    async () => permissions.includes(PERMISSIONS.view) && postsEnabled === true
      ? {
          categories: unwrap(await loadSiteTaxonomy(siteId, "categories")),
          tags: unwrap(await loadSiteTaxonomy(siteId, "tags")),
        }
      : { categories: EMPTY_TAXONOMY, tags: EMPTY_TAXONOMY },
    [siteId, permissions, postsEnabled],
  );

  const categories = taxonomy.data?.categories ?? EMPTY_TAXONOMY;
  const tags = taxonomy.data?.tags ?? EMPTY_TAXONOMY;
  const categoryNames = useMemo(() => new Map(categories.map((row) => [row.id, row.name])), [categories]);
  const tagNames = useMemo(() => new Map(tags.map((row) => [row.id, row.name])), [tags]);
  const missingCategories = taxonomy.data && !taxonomy.loading && !taxonomy.error
    ? form.categories.filter(id => !categoryNames.has(id)) : [];
  const missingTags = taxonomy.data && !taxonomy.loading && !taxonomy.error
    ? form.tags.filter(id => !tagNames.has(id)) : [];
  const enabled = postsEnabled === true && !saving && !loadingPost;
  const settingsEnabled = enabled && metadataEditable && (activePost ? canEdit : canCreate);
  const titleLabel = mode === "edit" || activePost ? "Edit Post" : "Create Post";
  const bodyFieldError = [
    attemptedSave || editorFieldError ? bodyProblem : "",
    editorFieldError,
  ].filter(Boolean).join(" ") || "";
  const seoFieldError = seoError(form.seo, siteId);
  const mediaFieldError = mediaReferenceError(form.featured_media.trim(), siteId);
  const saveBlocked = Boolean(
    !form.title.trim()
    || !form.slug.trim()
    || slugFieldError
    || bodyProblem
    || seoFieldError
    || mediaFieldError
  );
  const saveStatus = saving
    ? "Saving…"
    : dirty
      ? "Unsaved changes"
      : lastSavedAt
        ? "Draft saved just now"
        : activePost
          ? "All changes saved"
          : "Not saved yet";
  const primaryWorkflow = (activePost?.available_actions ?? []).find(
    (action) => action === "publish" || action === "submit",
  ) ?? null;

  async function confirmWorkflow() {
    if (!activePost || !workflowAction || workflowAction === "revise" || !activePost.etag || dirty || saving) return;
    setSaving(true); setWorkflowError("");
    try {
      const result = unwrap(await transitionSitePost(siteId,activePost.id,workflowAction,workflowComment,activePost.etag));
      const confirmed = workflowAction === "publish" && result.draft_of
        ? unwrap(await getSitePost(siteId,result.draft_of)) : result;
      setActivePost(confirmed);
      const next = formFromRecord(confirmed);
      baseline.current = JSON.stringify(next); setForm(next);
      setWorkflowAction(null);
      toast.success(`Article status is ${confirmed.status.replaceAll("_"," ").toLowerCase()}.`);
      if (confirmed.id !== activePost.id) router.replace(`/sites/${siteId}/admin/posts/${confirmed.id}/edit`);
    } catch (cause) {
      setWorkflowError(apiErrorText(cause,"The transition was rejected. Reload the current revision and retry."));
    } finally { setSaving(false); }
  }

  async function openWorkingDraft() {
    if (!activePost?.etag || dirty || saving) return;
    setSaving(true); setDialogError("");
    try {
      const draft = unwrap(await openSitePostWorkingDraft(siteId,activePost.id,activePost.etag));
      router.push(`/sites/${siteId}/admin/posts/${draft.id}/edit`);
    } catch (cause) { setDialogError(apiErrorText(cause,"The working draft could not be opened.")); }
    finally { setSaving(false); }
  }

  function leaveEditor() {
    if (saving || (dirty && !window.confirm("Discard unsaved article changes?"))) return;
    router.push(listHref);
  }

  async function savePost(): Promise<SitePostRecord | null> {
    if (!settingsEnabled) return null;
    setAttemptedSave(true);
    if (saveBlocked) return null;
    setSaving(true);
    setDialogError("");
    setFieldErrors({});
    setConflict(false);
    try {
      const blocks = parsedBlocks(form);
      const input = {
        title: form.title.trim(),
        slug: form.slug.trim(),
        excerpt: form.excerpt.trim(),
        ...(form.legacy ? {content: blockText(blocks), blocks} : {editor_document: normalizeArticleDocument({schema_version:1, html:form.html})}),
        seo: parseObject(form.seo, "SEO metadata"),
        featured_media: form.featured_media.trim(),
        featured_alt: form.featured_alt.trim(),
        categories: form.categories,
        tags: form.tags,
      };
      const saved = activePost
        ? (() => {
            if (!activePost.etag) throw new Error("The Post revision is unavailable. Reopen the editor and retry.");
            return updateSitePost(siteId, activePost.id, activePost.etag, input);
          })()
        : createSitePost(siteId, input);
      const current = unwrap(await saved);
      const nextForm = formFromRecord(current);
      baseline.current = JSON.stringify(nextForm);
      setForm(nextForm);
      setActivePost(current);
      setLastSavedAt(Date.now());
      setAttemptedSave(false);
      toast.success(activePost ? "Draft saved." : "Draft Post created.");
      if (!activePost || current.id !== activePost.id) {
        router.replace(`/sites/${siteId}/admin/posts/${current.id}/edit`);
      }
      return current;
    } catch (cause) {
      if (cause instanceof ApiError) setFieldErrors(cause.fieldErrors ?? {});
      if (cause instanceof ApiError && cause.status === 409) {
        setConflict(true);
        setDialogError(`${cause.message} Keep your text, refresh the revision marker, then save again.`);
      } else if (cause instanceof ApiError && cause.fieldErrors) {
        setDialogError(cause.message || "The Post could not be saved.");
      } else {
        setDialogError(apiErrorText(cause, "The Post could not be saved."));
      }
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function openPreview() {
    if (!enabled || saving) return;
    const target = window.open("about:blank", "_blank");
    if (!target) {
      setDialogError("Allow pop-ups for this Site to open the Post preview.");
      return;
    }
    target.opener = null;
    let postId = activePost?.id;
    if (!postId || dirty) {
      const saved = await savePost();
      if (!saved) {
        target.close();
        return;
      }
      postId = saved.id;
    }
    target.location.replace(`${APP_BASE_PATH}/sites/${siteId}/admin/posts/${postId}/preview`);
  }

  async function refreshRevisionMarker() {
    if (!activePost || saving) return;
    setSaving(true);
    setDialogError("");
    try {
      const current = unwrap(await getSitePost(siteId, activePost.id));
      if (!current.etag) throw new Error("The latest Post revision marker is unavailable.");
      setActivePost(current);
      setConflict(false);
      toast.success("Revision marker refreshed. Your unsaved text is still in the editor — save again when ready.");
    } catch (cause) {
      setDialogError(apiErrorText(cause, "The latest revision could not be loaded."));
    } finally {
      setSaving(false);
    }
  }

  async function loadServerVersion() {
    if (!activePost || saving) return;
    if (dirty && !window.confirm("Replace your unsaved article text with the latest saved revision?")) return;
    setSaving(true);
    setDialogError("");
    setFieldErrors({});
    try {
      const current = unwrap(await getSitePost(siteId, activePost.id));
      setActivePost(current);
      const nextForm = formFromRecord(current);
      baseline.current = JSON.stringify(nextForm);
      setForm(nextForm);
      setConflict(false);
      toast.success("Loaded the latest saved revision.");
    } catch (cause) {
      setDialogError(apiErrorText(cause, "The latest revision could not be loaded."));
    } finally {
      setSaving(false);
    }
  }

  function openTaxonomy(kind: "categories" | "tags") {
    if (!canCreate || !enabled) return;
    setTaxonomyTarget(kind);
    setTaxonomyName("");
    setTaxonomyCode("");
    setTaxonomyDialogError("");
  }

  async function saveTaxonomy() {
    if (!taxonomyTarget || !canCreate || !enabled) return;
    const name = taxonomyName.trim();
    const code = taxonomyCode.trim().toUpperCase();
    if (!name) { setTaxonomyDialogError("Provide a name."); return; }
    if (!/^[A-Z][A-Z0-9_-]{0,63}$/.test(code)) {
      setTaxonomyDialogError("Use an uppercase code such as CAMPUS_NEWS.");
      return;
    }
    setTaxonomySaving(true);
    setTaxonomyDialogError("");
    try {
      const created = unwrap(await createSiteTaxonomy(siteId, taxonomyTarget, {
        code, name, slug: "", is_active: true, locale: "en",
      }));
      setForm((current) => taxonomyTarget === "categories"
        ? { ...current, categories: [...new Set([...current.categories, created.id])] }
        : { ...current, tags: [...new Set([...current.tags, created.id])] });
      setTaxonomyTarget(null);
      taxonomy.reload();
      toast.success(`${taxonomyTarget === "categories" ? "Category" : "Tag"} created.`);
    } catch (cause) {
      setTaxonomyDialogError(apiErrorText(cause, "The taxonomy item could not be created."));
    } finally {
      setTaxonomySaving(false);
    }
  }

  if (mode === "create" && (!canCreate || postsEnabled !== true)) {
    return (
      <Paper variant="outlined" sx={{ borderRadius: 3, p: { xs: 2, sm: 3 } }}>
        <Alert severity="warning">
          {postsEnabled === false
            ? "Posts are disabled for this Site. Create and edit actions are blocked."
            : "You do not have permission to create Posts for this Site."}
        </Alert>
        <Button component={Link} href={listHref} sx={{ mt: 2 }}>Back to Posts</Button>
      </Paper>
    );
  }

  if (loadingPost) {
    return <Typography role="status">Loading article editor…</Typography>;
  }

  if (loadError) {
    return (
      <Paper variant="outlined" sx={{ borderRadius: 3, p: { xs: 2, sm: 3 } }}>
        <Alert severity="error" role="alert">{loadError}</Alert>
        <Button component={Link} href={listHref} sx={{ mt: 2 }}>Back to Posts</Button>
      </Paper>
    );
  }

  const sidebarCardSx = {
    p: 2,
    borderRadius: 2,
    display: "flex",
    flexDirection: "column",
    gap: 1.5,
  } as const;

  return (
    <Box
      component="section"
      aria-labelledby="post-editor-title"
      sx={{ display: "flex", flexDirection: "column", gap: 2, pb: 4, "& .MuiFormHelperText-root.Mui-disabled": { color: "text.secondary" } }}
    >
      <Box
        sx={{
          position: "sticky",
          top: 0,
          zIndex: 8,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2,
          px: { xs: 2, sm: 2.5 },
          py: 1.5,
          borderRadius: 2,
          border: "1px solid",
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography id="post-editor-title" variant="h1" sx={{ fontSize: "1.35rem", fontWeight: 800 }}>
            {titleLabel}
          </Typography>
          <Typography variant="body2" color="text.secondary" role="status">
            {saveStatus}
          </Typography>
        </Box>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
          <Button onClick={leaveEditor} disabled={saving}>Cancel</Button>
          <Button variant="outlined" onClick={() => void savePost()} disabled={!settingsEnabled}>
            {saving ? "Saving…" : "Save Draft"}
          </Button>
          <Button
            variant="outlined"
            onClick={() => void openPreview()}
            disabled={!enabled || saving || (!activePost && !dirty) || (dirty && !settingsEnabled)}
          >
            Preview
          </Button>
          {primaryWorkflow && activePost ? (
            <Button
              variant="contained"
              disabled={!enabled || dirty || saving}
              onClick={() => {
                setWorkflowAction(primaryWorkflow);
                setWorkflowComment("");
                setWorkflowError("");
              }}
            >
              {primaryWorkflow === "publish" ? "Publish Post" : "Submit for review"}
            </Button>
          ) : null}
        </Box>
      </Box>

      {dialogError ? (
        <Alert
          severity="error"
          role="alert"
          action={conflict && activePost ? (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, alignItems: "stretch", minWidth: 180 }}>
              <Button color="inherit" size="small" disabled={saving} onClick={() => void refreshRevisionMarker()}>Keep my text & refresh</Button>
              <Button color="inherit" size="small" disabled={saving} onClick={() => void loadServerVersion()}>Load server version</Button>
            </Box>
          ) : undefined}
        >
          {dialogError}
        </Alert>
      ) : null}
      {!metadataEditable ? (
        <Alert severity="info" role="status">
          Title, permalink, summary, article body, categories and tags are locked while this Post is {activePost?.status.replaceAll("_", " ").toLowerCase()}. Return it to draft through the workflow before changing them.
        </Alert>
      ) : null}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 7fr) minmax(280px, 3fr)" },
          gap: 2,
          alignItems: "start",
        }}
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <Paper variant="outlined" sx={sidebarCardSx}>
            <TextField
              label="Title"
              value={form.title}
              onChange={(event) => setForm((current) => {
                const title = event.target.value;
                const syncSlug = !activePost?.draft_of
                  && (mode === "create" || !activePost || activePost.status === "DRAFT" || activePost.status === "UNPUBLISHED")
                  && current.slug === slugFromTitle(current.title);
                return {
                  ...current,
                  title,
                  slug: syncSlug ? slugFromTitle(title) : current.slug,
                };
              })}
              required
              inputProps={{ maxLength: 255 }}
              disabled={!settingsEnabled}
              error={Boolean(attemptedSave && !form.title.trim()) || Boolean(fieldErrors.title)}
              helperText={fieldErrors.title?.join(" ") || (attemptedSave && !form.title.trim() ? "Add a title." : undefined)}
              autoFocus={metadataEditable}
            />
            <TextField
              label="Permalink slug"
              value={activePost?.draft_of ? activePost.publication_slug ?? form.slug : form.slug}
              onChange={(event) => {
                setForm((current) => ({ ...current, slug: event.target.value }));
                setFieldErrors((current) => ({ ...current, slug: [] }));
              }}
              required
              inputProps={{ maxLength: 128 }}
              disabled={!settingsEnabled || Boolean(activePost?.draft_of)}
              error={Boolean(slugFieldError)}
              helperText={slugFieldError
                || (activePost?.draft_of
                  ? `Public path: /posts/${activePost.publication_slug || form.slug.trim() || "your-slug"}`
                  : `Filled from the title until you edit it. Public path: /posts/${form.slug.trim() || "your-slug"}`)}
            />
          </Paper>

          <Paper variant="outlined" sx={{ ...sidebarCardSx, gap: 1 }}>
            <Typography variant="subtitle2" component="h2" sx={{ fontWeight: 700 }}>
              Article body *
            </Typography>
            {!form.legacy ? (
              <PostRichEditor
                siteId={siteId}
                canUseMedia={canUseMedia}
                canUploadMedia={canUploadMedia}
                value={form.html}
                onChange={(html) => setForm((current) => ({ ...current, html }))}
                disabled={!settingsEnabled}
                onSave={() => void savePost()}
                error={bodyFieldError}
              />
            ) : (
              <Box component="section" aria-label="Post content blocks" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {bodyFieldError ? <Alert severity="error" role="alert">{bodyFieldError}</Alert> : null}
                {form.blocks.map((block, index) => (
                  <Paper key={`post-block-${index}`} variant="outlined" sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
                    <Typography variant="caption">Block {index + 1} - same block format as Pages</Typography>
                    <TextField label={`Block ${index + 1} JSON`} value={block} onChange={(event) => setForm((current) => ({ ...current, blocks: current.blocks.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} multiline minRows={3} fullWidth />
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                      <Button aria-label={`Move Post block ${index + 1} up`} disabled={index === 0 || !settingsEnabled} onClick={() => setForm((current) => { const blocks = [...current.blocks]; [blocks[index - 1], blocks[index]] = [blocks[index], blocks[index - 1]]; return { ...current, blocks }; })}>Move up</Button>
                      <Button aria-label={`Move Post block ${index + 1} down`} disabled={index === form.blocks.length - 1 || !settingsEnabled} onClick={() => setForm((current) => { const blocks = [...current.blocks]; [blocks[index + 1], blocks[index]] = [blocks[index], blocks[index + 1]]; return { ...current, blocks }; })}>Move down</Button>
                      <Button aria-label={`Remove Post block ${index + 1}`} disabled={!settingsEnabled} onClick={() => setForm((current) => ({ ...current, blocks: current.blocks.filter((_, itemIndex) => itemIndex !== index) }))}>Remove</Button>
                    </Box>
                  </Paper>
                ))}
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                  <Button disabled={!settingsEnabled} onClick={() => setForm((current) => ({ ...current, blocks: [...current.blocks, '{"type":"heading","level":2,"text":"New heading"}'] }))}>Add heading</Button>
                  <Button disabled={!settingsEnabled} onClick={() => setForm((current) => ({ ...current, blocks: [...current.blocks, '{"type":"paragraph","html":"<p>New paragraph</p>"}'] }))}>Add paragraph</Button>
                  <Button disabled={!settingsEnabled} onClick={() => setForm((current) => ({ ...current, blocks: [...current.blocks, JSON.stringify({ type: "image", alt: "Describe this image", ref: `sites/${siteId}/image` })] }))}>Add image</Button>
                  <Button disabled={!settingsEnabled} onClick={() => setForm((current) => ({ ...current, blocks: [...current.blocks, '{"type":"button","label":"Learn more","href":"/"}'] }))}>Add button</Button>
                  <Button disabled={!settingsEnabled} onClick={() => setForm((current) => ({ ...current, blocks: [...current.blocks, '{"type":"list","style":"unordered","items":["First item"]}'] }))}>Add list</Button>
                  <Button disabled={!settingsEnabled} onClick={() => setForm((current) => ({ ...current, blocks: [...current.blocks, '{"type":"section","heading":"New section","children":[]}'] }))}>Add section</Button>
                </Box>
              </Box>
            )}
          </Paper>

          <Paper variant="outlined" sx={sidebarCardSx}>
            <Button onClick={() => setShowDraftPreview((value) => !value)} aria-expanded={showDraftPreview}>
              {showDraftPreview ? "Hide preview" : "Preview draft"}
            </Button>
            {showDraftPreview ? (
              <Box role="region" aria-label="Private Post preview">
                <Typography variant="overline">Private draft preview</Typography>
                {(() => {
                  try {
                    if (!form.legacy) {
                      return (
                        <>
                          <Typography variant="h1">{form.title || "Untitled Post"}</Typography>
                          <ArticleDocumentView siteId={siteId} mediaBase={`${APP_BASE_PATH}/sites/${siteId}/media`} document={{ schema_version: 1, html: form.html }} />
                        </>
                      );
                    }
                    const seo = parseObject(form.seo, "SEO metadata");
                    return (
                      <PublicPageView
                        page={{
                          title: form.title || "Untitled Post",
                          path: `/${form.slug}`,
                          site: siteId,
                          blocks: parsedBlocks(form),
                          seo: {
                            title: typeof seo.meta_title === "string" ? seo.meta_title : "",
                            description: typeof seo.meta_description === "string" ? seo.meta_description : "",
                          },
                        }}
                      />
                    );
                  } catch (cause) {
                    return <Alert severity="error">{cause instanceof Error ? cause.message : "Fix block errors to preview this Post."}</Alert>;
                  }
                })()}
              </Box>
            ) : null}
          </Paper>
        </Box>

        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <Paper variant="outlined" component="section" aria-label="Publish settings" sx={sidebarCardSx}>
            <Typography variant="subtitle2" component="h2" sx={{ fontWeight: 700 }}>Publish</Typography>
            {activePost ? (
              <>
                <Typography role="status" variant="body2">
                  Status: {activePost.status.replaceAll("_", " ").toLowerCase()}
                  {activePost.revision_number != null ? ` · Revision ${activePost.revision_number}` : ""}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Last publication: {activePost.last_publication_at || activePost.published_at
                    ? new Date(activePost.last_publication_at || activePost.published_at!).toLocaleString()
                    : "Never published"}
                </Typography>
                {activePost.review_comment ? <Alert severity="info">Reviewer comment: {activePost.review_comment}</Alert> : null}
                {activePost.draft_of ? <Alert severity="info">This working draft revises /posts/{activePost.publication_slug}. Original article status {activePost.publication_status?.replaceAll("_"," ").toLowerCase() || "published"}. <Link href={`/sites/${siteId}/admin/posts/${activePost.draft_of}/edit`}>Open original article</Link></Alert> : null}
                {dirty ? <Typography variant="body2">Save or use Preview in the top bar before changing review status.</Typography> : null}
                <Typography variant="body2" color="text.secondary">
                  Preview opens in a new tab with this Site’s header, footer and article banner.
                </Typography>
                {canEdit && activePost.status === "PUBLISHED" ? (
                  <Button disabled={!enabled || dirty} size="small" onClick={() => void openWorkingDraft()}>Edit working draft</Button>
                ) : null}
                <ContentWorkflowButtons
                  title={activePost.title}
                  available={activePost.available_actions ?? []}
                  disabled={!enabled || dirty}
                  onAction={(action) => {
                    setWorkflowAction(action);
                    setWorkflowComment("");
                    setWorkflowError("");
                  }}
                />
              </>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Save a draft first. Workflow actions appear after the Post exists.
              </Typography>
            )}
          </Paper>

          <Paper variant="outlined" component="section" aria-label="Excerpt" sx={sidebarCardSx}>
            <Typography variant="subtitle2" component="h2" sx={{ fontWeight: 700 }}>Excerpt</Typography>
            <TextField
              label="Excerpt"
              value={form.excerpt}
              onChange={(event) => setForm((current) => ({ ...current, excerpt: event.target.value }))}
              multiline
              minRows={3}
              disabled={!settingsEnabled}
              helperText="Short summary shown on the public listing. Max 160 characters recommended."
              inputProps={{ maxLength: 500 }}
            />
          </Paper>

          <Paper variant="outlined" component="section" aria-label="Featured image" sx={sidebarCardSx}>
            <Typography variant="subtitle2" component="h2" sx={{ fontWeight: 700 }}>Featured image</Typography>
            {form.featured_media && /^sites\/\d+\/assets\/[0-9a-f-]{36}$/.test(form.featured_media) ? (
              <ArticleAssetImage key={form.featured_media} siteId={siteId} assetId={form.featured_media.split("/")[3]!} mediaBase={`${APP_BASE_PATH}/sites/${siteId}/media`} alt={form.featured_alt || "Selected featured image"} />
            ) : null}
            {form.featured_media && !/^sites\/\d+\/assets\/[0-9a-f-]{36}$/.test(form.featured_media) ? (
              <Typography variant="body2">Legacy featured image. Choose a library image to replace it, or correct the reference below.</Typography>
            ) : null}
            {!form.featured_media ? <Typography variant="body2" color="text.secondary">No featured image selected.</Typography> : null}
            <TextField
              fullWidth
              label="Featured image reference"
              value={form.featured_media}
              onChange={(event) => setForm((current) => ({ ...current, featured_media: event.target.value }))}
              disabled={!settingsEnabled}
              error={Boolean(mediaFieldError || fieldErrors.featured_media?.length)}
              helperText={mediaFieldError || fieldErrors.featured_media?.join(" ") || "Use a media reference under this Site or shared/."}
            />
            <TextField
              fullWidth
              label="Featured image alternative text"
              value={form.featured_alt}
              onChange={(event) => setForm((current) => ({ ...current, featured_alt: event.target.value }))}
              disabled={!settingsEnabled || !canUseMedia}
              inputProps={{ maxLength: 1000 }}
              error={Boolean(fieldErrors.featured_alt?.length)}
              helperText={fieldErrors.featured_alt?.join(" ") || "Describe the image for readers who cannot see it."}
            />
            {form.featured_media ? <Button disabled={!settingsEnabled} onClick={() => setForm((current) => ({ ...current, featured_media: "", featured_alt: "" }))}>Remove featured image</Button> : null}
            {canUseMedia ? (
              <Button ref={featuredButton} disabled={!settingsEnabled} onClick={() => setFeaturedPicker(true)}>
                {form.featured_media ? "Replace featured image" : "Choose featured image"}
              </Button>
            ) : (
              <Typography variant="body2">Media access and the MEDIA module are required to select images.</Typography>
            )}
            <MediaPickerDialog
              open={featuredPicker && canUseMedia}
              siteId={siteId}
              canUpload={canUploadMedia}
              returnFocusRef={featuredButton}
              title="Choose a featured image"
              onCancel={() => setFeaturedPicker(false)}
              onConfirm={(result) => {
                setFeaturedPicker(false);
                setForm((current) => ({
                  ...current,
                  featured_media: `sites/${siteId}/assets/${result.assetId}`,
                  featured_alt: result.altText,
                }));
              }}
            />
          </Paper>

          <Paper variant="outlined" component="section" aria-label="Categories and tags" sx={sidebarCardSx}>
            <Typography variant="subtitle2" component="h2" sx={{ fontWeight: 700 }}>Categories & tags</Typography>
            {missingCategories.length || missingTags.length ? (
              <Alert severity="warning">Some selected categories or tags are unavailable. Remove the unavailable selections or reload the choices.</Alert>
            ) : null}
            <Button onClick={taxonomy.reload} disabled={taxonomy.loading || saving} size="small">Reload categories and tags</Button>
            <FormControl fullWidth error={Boolean(categoryFieldError)}>
              <InputLabel id="post-categories-label">Categories</InputLabel>
              <Select
                multiple
                labelId="post-categories-label"
                label="Categories"
                value={form.categories}
                input={<OutlinedInput label="Categories" />}
                disabled={!settingsEnabled || taxonomy.loading}
                renderValue={(selected) => selected.map((id) => categoryNames.get(id) ?? (taxonomy.loading ? "Loading category..." : `Unavailable category (${id})`)).join(", ")}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  categories: typeof event.target.value === "string" ? event.target.value.split(",") : event.target.value,
                }))}
              >
                {categories.map((row) => <MenuItem key={row.id} value={row.id}><ListItemText primary={row.name} /></MenuItem>)}
                {missingCategories.map((id) => <MenuItem key={id} value={id}><ListItemText primary={`Unavailable category (${id})`} /></MenuItem>)}
              </Select>
              {categoryFieldError ? <Typography variant="caption" color="error" role="alert" sx={{ mt: 0.5 }}>{categoryFieldError}</Typography> : null}
            </FormControl>
            {!taxonomy.loading && !taxonomy.error && taxonomy.data && !categories.length ? (
              <Typography variant="body2" color="text.secondary">No active categories for this Site.</Typography>
            ) : null}
            {canCreate ? <Button disabled={!settingsEnabled} onClick={() => openTaxonomy("categories")}>Create category</Button> : null}
            <FormControl fullWidth error={Boolean(tagFieldError)}>
              <InputLabel id="post-tags-label">Tags</InputLabel>
              <Select
                multiple
                labelId="post-tags-label"
                label="Tags"
                value={form.tags}
                input={<OutlinedInput label="Tags" />}
                disabled={!settingsEnabled || taxonomy.loading}
                renderValue={(selected) => selected.map((id) => tagNames.get(id) ?? (taxonomy.loading ? "Loading tag..." : `Unavailable tag (${id})`)).join(", ")}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  tags: typeof event.target.value === "string" ? event.target.value.split(",") : event.target.value,
                }))}
              >
                {tags.map((row) => <MenuItem key={row.id} value={row.id}><ListItemText primary={row.name} /></MenuItem>)}
                {missingTags.map((id) => <MenuItem key={id} value={id}><ListItemText primary={`Unavailable tag (${id})`} /></MenuItem>)}
              </Select>
              {tagFieldError ? <Typography variant="caption" color="error" role="alert" sx={{ mt: 0.5 }}>{tagFieldError}</Typography> : null}
            </FormControl>
            {!taxonomy.loading && !taxonomy.error && taxonomy.data && !tags.length ? (
              <Typography variant="body2" color="text.secondary">No active tags for this Site.</Typography>
            ) : null}
            {canCreate ? <Button disabled={!settingsEnabled} onClick={() => openTaxonomy("tags")}>Create tag</Button> : null}
          </Paper>

          <Paper variant="outlined" component="section" aria-label="SEO" sx={sidebarCardSx}>
            <Typography variant="subtitle2" component="h2" sx={{ fontWeight: 700 }}>SEO</Typography>
            <TextField
              label="SEO metadata (JSON object)"
              value={form.seo}
              onChange={(event) => setForm((current) => ({ ...current, seo: event.target.value }))}
              multiline
              minRows={3}
              disabled={!settingsEnabled}
              error={Boolean(seoFieldError)}
              helperText={seoFieldError || "Allowed keys: meta_title, meta_description and og_image_ref."}
            />
          </Paper>
        </Box>
      </Box>

      <ContentWorkflowDialog
        noun="Post"
        action={workflowAction}
        title={activePost?.title ?? ""}
        comment={workflowComment}
        error={workflowError}
        busy={saving}
        onComment={setWorkflowComment}
        onClose={() => { if (!saving) setWorkflowAction(null); }}
        onConfirm={() => void confirmWorkflow()}
      />

      <Dialog open={taxonomyTarget !== null} onClose={() => { if (!taxonomySaving) setTaxonomyTarget(null); }} fullWidth maxWidth="sm" aria-labelledby="taxonomy-dialog-title">
        <DialogTitle id="taxonomy-dialog-title">Create {taxonomyTarget === "categories" ? "category" : "tag"}</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
          {taxonomyDialogError ? <Alert severity="error" role="alert">{taxonomyDialogError}</Alert> : null}
          <TextField label="Name" value={taxonomyName} onChange={(event) => { setTaxonomyName(event.target.value); setTaxonomyCode(event.target.value.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, "_")); }} required disabled={taxonomySaving} />
          <TextField label="Code" value={taxonomyCode} onChange={(event) => setTaxonomyCode(event.target.value.toUpperCase())} required disabled={taxonomySaving} helperText="Starts with a letter; use uppercase letters, numbers, underscores or hyphens." />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTaxonomyTarget(null)} disabled={taxonomySaving}>Cancel</Button>
          <Button variant="contained" onClick={() => void saveTaxonomy()} disabled={taxonomySaving || !taxonomyName.trim() || !/^[A-Z][A-Z0-9_-]{0,63}$/.test(taxonomyCode)}>{taxonomySaving ? "Saving…" : "Create and assign"}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
