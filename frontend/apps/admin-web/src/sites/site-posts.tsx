"use client";

import { useMemo, useState } from "react";
import AddIcon from "@mui/icons-material/Add";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
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
  DataTable, FilterBar, Pagination, PublicPageView, SelectFilter, TextFilter, useAsync, useToast,
} from "@uog/ui";
import type { SortState, TableColumn } from "@uog/ui";

import {
  createSiteTaxonomy,
  createSitePost,
  getSitePost,
  loadSitePosts,
  loadSiteTaxonomy,
  transitionSitePost,
  updateSitePost,
} from "@/app/sites/post-actions";
import type {
  SitePostListQuery,
  SitePostListResponse,
  SitePostRecord,
  SitePostStatus,
  SitePostBlock,
  SitePostWorkflowAction,
  SiteTaxonomyRecord,
} from "@/app/sites/post-actions";
import { unwrap } from "@/organizations/contract";

const PAGE_SIZE = 20;
const STATUSES: readonly SitePostStatus[] = [
  "DRAFT", "IN_REVIEW", "APPROVED", "PUBLISHED", "UNPUBLISHED", "ARCHIVED",
];
const STATUS_LABELS: Record<SitePostStatus, string> = {
  DRAFT: "Draft",
  IN_REVIEW: "In review",
  APPROVED: "Approved",
  PUBLISHED: "Published",
  UNPUBLISHED: "Unpublished",
  ARCHIVED: "Archived",
};
const PERMISSIONS = {
  view: "content.posts.view",
  create: "content.posts.create",
  update: "content.posts.update",
} as const;
const EMPTY_LIST: SitePostListResponse = { count: 0, next: null, previous: null, results: [] };
const EMPTY_TAXONOMY: SiteTaxonomyRecord[] = [];

interface PostFilters {
  search: string;
  status: SitePostStatus | "";
  category: string;
  tag: string;
}

interface PostForm {
  title: string;
  slug: string;
  excerpt: string;
  blocks: string[];
  seo: string;
  featured_media: string;
  categories: string[];
  tags: string[];
}

function emptyForm(): PostForm {
  return {
    title: "", slug: "", excerpt: "", blocks: [],
    seo: "{}", featured_media: "", categories: [], tags: [],
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

function slugError(value: string): string {
  return value && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.trim())
    ? "Use lowercase letters and numbers separated by single hyphens."
    : "";
}

function blocksError(form: PostForm): string {
  try {
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

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function orderingForSort(sort: SortState): SitePostListQuery["ordering"] {
  const field = sort.field === "title" ? "title" : sort.field === "published_at" ? "published_at" : "created_at";
  return sort.direction === "desc" ? `-${field}` as SitePostListQuery["ordering"] : field;
}

export function SitePostsPanel({
  siteId,
  postsEnabled,
  permissions = [],
}: {
  siteId: number;
  postsEnabled: boolean | null;
  permissions?: readonly string[];
}) {
  return (
    <SitePostsPanelContent
      key={siteId}
      siteId={siteId}
      postsEnabled={postsEnabled}
      permissions={permissions}
    />
  );
}

function SitePostsPanelContent({
  siteId,
  postsEnabled,
  permissions,
}: {
  siteId: number;
  postsEnabled: boolean | null;
  permissions: readonly string[];
}) {
  const toast = useToast();
  const canView = permissions.includes(PERMISSIONS.view);
  const canCreate = permissions.includes(PERMISSIONS.create);
  const canEdit = permissions.includes(PERMISSIONS.update);
  const [draftFilters, setDraftFilters] = useState<PostFilters>({ search: "", status: "", category: "", tag: "" });
  const [appliedFilters, setAppliedFilters] = useState<PostFilters>({ search: "", status: "", category: "", tag: "" });
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ field: "created_at", direction: "desc" });
  const [editorOpen, setEditorOpen] = useState(false);
  const [activePost, setActivePost] = useState<SitePostRecord | null>(null);
  const [form, setForm] = useState<PostForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [showDraftPreview, setShowDraftPreview] = useState(false);
  const [taxonomyTarget, setTaxonomyTarget] = useState<"categories" | "tags" | null>(null);
  const [taxonomyName, setTaxonomyName] = useState("");
  const [taxonomyCode, setTaxonomyCode] = useState("");
  const [taxonomyDialogError, setTaxonomyDialogError] = useState("");
  const [taxonomySaving, setTaxonomySaving] = useState(false);
  const [pendingWorkflow, setPendingWorkflow] = useState<{ post: SitePostRecord; action: SitePostWorkflowAction } | null>(null);
  const [workflowComment, setWorkflowComment] = useState("");
  const [busyPostId, setBusyPostId] = useState<string | null>(null);

  const ordering = orderingForSort(sort);
  const posts = useAsync<SitePostListResponse>(
    async () => canView && postsEnabled === true
      ? unwrap(await loadSitePosts(siteId, {
          search: appliedFilters.search || undefined,
          status: appliedFilters.status || undefined,
          category: appliedFilters.category || undefined,
          tag: appliedFilters.tag || undefined,
          page,
          page_size: PAGE_SIZE,
          ordering,
        }))
      : EMPTY_LIST,
    [siteId, canView, postsEnabled, appliedFilters.search, appliedFilters.status, appliedFilters.category, appliedFilters.tag, page, ordering],
    { isEmpty: (data) => data.count === 0 },
  );
  const taxonomy = useAsync<{ categories: SiteTaxonomyRecord[]; tags: SiteTaxonomyRecord[] }>(
    async () => canView && postsEnabled === true
      ? {
          categories: unwrap(await loadSiteTaxonomy(siteId, "categories")),
          tags: unwrap(await loadSiteTaxonomy(siteId, "tags")),
        }
      : { categories: EMPTY_TAXONOMY, tags: EMPTY_TAXONOMY },
    [siteId, canView, postsEnabled],
  );

  const categories = taxonomy.data?.categories ?? EMPTY_TAXONOMY;
  const tags = taxonomy.data?.tags ?? EMPTY_TAXONOMY;
  const categoryNames = useMemo(() => new Map(categories.map((row) => [row.id, row.name])), [categories]);
  const tagNames = useMemo(() => new Map(tags.map((row) => [row.id, row.name])), [tags]);
  const rows = (posts.data?.results ?? []).filter((row) => row.site === siteId);
  const enabled = postsEnabled === true && !saving && busyPostId === null;
  const activeFilterCount = Number(Boolean(appliedFilters.search))
    + Number(Boolean(appliedFilters.status))
    + Number(Boolean(appliedFilters.category))
    + Number(Boolean(appliedFilters.tag));

  function applyFilters() {
    setAppliedFilters({
      search: draftFilters.search.trim(), status: draftFilters.status,
      category: draftFilters.category, tag: draftFilters.tag,
    });
    setPage(1);
  }

  function resetFilters() {
    const cleared = { search: "", status: "" as const, category: "", tag: "" };
    setDraftFilters(cleared);
    setAppliedFilters(cleared);
    setPage(1);
  }

  function openCreate() {
    if (!canCreate || !enabled) return;
    setActivePost(null);
    setForm(emptyForm());
    setDialogError("");
    setEditorOpen(true);
  }

  async function openEdit(row: SitePostRecord) {
    if (!canEdit || !enabled) return;
    setSaving(true);
    setDialogError("");
    try {
      const current = unwrap(await getSitePost(siteId, row.id));
      setActivePost(current);
      setForm({
        title: current.title,
        slug: current.slug,
        excerpt: current.excerpt,
        blocks: current.blocks?.length
          ? current.blocks.map((block) => JSON.stringify(block, null, 2))
          : [JSON.stringify({ type: "paragraph", html: `<p>${escapeHtml(current.content ?? "")}</p>` }, null, 2)],
        seo: JSON.stringify(current.seo ?? {}, null, 2),
        featured_media: current.featured_media ?? "",
        categories: current.categories ?? [],
        tags: current.tags ?? [],
      });
      setEditorOpen(true);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "The Post could not be loaded.");
    } finally {
      setSaving(false);
    }
  }

  async function savePost() {
    if (!enabled || (activePost ? !canEdit : !canCreate)) return;
    setSaving(true);
    setDialogError("");
    try {
      if (slugError(form.slug)) throw new Error(slugError(form.slug));
      const mediaError = mediaReferenceError(form.featured_media.trim(), siteId);
      if (mediaError) throw new Error(mediaError);
      if (blocksError(form)) throw new Error(blocksError(form));
      if (seoError(form.seo, siteId)) throw new Error(seoError(form.seo, siteId));
      const blocks = parsedBlocks(form);
      const input = {
        title: form.title.trim(),
        slug: form.slug.trim(),
        excerpt: form.excerpt.trim(),
        content: blockText(blocks),
        blocks,
        seo: parseObject(form.seo, "SEO metadata"),
        featured_media: form.featured_media.trim(),
        categories: form.categories,
        tags: form.tags,
      };
      if (activePost) {
        if (!activePost.etag) throw new Error("The Post revision is unavailable. Reopen the editor and retry.");
        unwrap(await updateSitePost(siteId, activePost.id, activePost.etag, input));
      } else {
        unwrap(await createSitePost(siteId, input));
      }
      setEditorOpen(false);
      setActivePost(null);
      setShowDraftPreview(false);
      posts.reload();
      toast.success(activePost ? "Post updated." : "Draft Post created.");
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setDialogError(`${apiErrorText(cause, "The Post could not be saved.")} Reload the Post before saving again.`);
      } else {
        setDialogError(apiErrorText(cause, "The Post could not be saved."));
      }
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

  function queueWorkflow(row: SitePostRecord, action: SitePostWorkflowAction) {
    if (!enabled) return;
    setWorkflowComment("");
    setPendingWorkflow({ post: row, action });
  }

  async function confirmWorkflow() {
    if (!pendingWorkflow || !enabled) return;
    const { post: row, action } = pendingWorkflow;
    if (action === "reject" && !workflowComment.trim()) return;
    setBusyPostId(row.id);
    try {
      unwrap(await transitionSitePost(siteId, row.id, action, workflowComment.trim()));
      setPendingWorkflow(null);
      posts.reload();
      toast.success(`Post ${action} completed.`);
    } catch (cause) {
      toast.error(apiErrorText(cause, "The Post workflow could not be updated."));
    } finally {
      setBusyPostId(null);
    }
  }

  const columns: TableColumn<SitePostRecord>[] = [
    {
      field: "title", header: "Post", sortable: true,
      render: (row) => (
        <Box sx={{ minWidth: 150 }}>
          <Typography fontWeight={600}>{row.title}</Typography>
          <Typography variant="caption" color="text.secondary">/{row.slug}</Typography>
        </Box>
      ),
    },
    {
      field: "status", header: "Status",
      render: (row) => <Chip size="small" label={STATUS_LABELS[row.status]} color={row.status === "PUBLISHED" ? "success" : row.status === "IN_REVIEW" ? "info" : "default"} />,
    },
    { field: "author", header: "Author", render: (row) => row.author == null ? "—" : `User ${row.author}` },
    {
      field: "categories", header: "Categories",
      render: (row) => row.categories.map((id) => categoryNames.get(id) ?? "Category").join(", ") || "—",
    },
    { field: "tags", header: "Tags", render: (row) => row.tags.map((id) => tagNames.get(id) ?? "Tag").join(", ") || "—" },
    {
      field: "published_at", header: "Published", sortable: true,
      render: (row) => formatDate(row.published_at),
    },
    {
      field: "created_at", header: "Created", sortable: true,
      render: (row) => formatDate(row.created_at),
    },
    {
      field: "featured_media", header: "Featured image",
      render: (row) => row.featured_media ? <Chip size="small" variant="outlined" label="Set" /> : "Not set",
    },
  ];

  return (
    <Paper variant="outlined" sx={{ borderRadius: 3, p: { xs: 2, sm: 3 }, display: "flex", flexDirection: "column", gap: 2 }}>
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
        <Box>
          <Typography variant="h2" component="h2" sx={{ fontSize: "1.25rem", fontWeight: 700 }}>Posts</Typography>
          <Typography variant="body2" color="text.secondary">Search and manage Posts belonging to this Site.</Typography>
        </Box>
        {canCreate && postsEnabled === true ? <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} disabled={!enabled}>Create Post</Button> : null}
      </Box>

      {postsEnabled === null ? <Typography role="status">Checking the POSTS module…</Typography> : null}
      {postsEnabled === false ? <Alert severity="warning">Posts are disabled for this Site. Create and edit actions are blocked.</Alert> : null}
      {!canView ? <Alert severity="warning">You do not have permission to view Posts for this Site.</Alert> : null}
      {taxonomy.error ? <Alert severity="error" role="alert">Category and Tag filters could not be loaded: {taxonomy.error.message}</Alert> : null}

      {canView ? (
        <>
          <FilterBar label="Post filters" activeCount={activeFilterCount} onApply={applyFilters} onReset={resetFilters} resetDisabled={posts.loading && !posts.data}>
            <TextFilter label="Search Posts" placeholder="Title, slug, excerpt or content" value={draftFilters.search} onChange={(search) => setDraftFilters((current) => ({ ...current, search }))} />
            <SelectFilter label="Status" value={draftFilters.status} options={STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] }))} onChange={(status) => setDraftFilters((current) => ({ ...current, status: STATUSES.find((candidate) => candidate === status) ?? "" }))} />
            <SelectFilter label="Category" value={draftFilters.category} options={categories.map((row) => ({ value: row.id, label: row.name }))} onChange={(category) => setDraftFilters((current) => ({ ...current, category }))} />
            <SelectFilter label="Tag" value={draftFilters.tag} options={tags.map((row) => ({ value: row.id, label: row.name }))} onChange={(tag) => setDraftFilters((current) => ({ ...current, tag }))} />
          </FilterBar>

          <Box data-testid="posts-table-scroll" sx={{ overflowX: "auto", width: "100%" }}>
            <DataTable
              caption="Posts for this Site"
              columns={columns}
              rows={rows}
              getRowKey={(row) => row.id}
              renderActions={(row) => {
                const actions = new Set(row.available_actions ?? []);
                return (
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                    {canEdit ? (
                      <Button size="small" aria-label={`Edit ${row.title}`} disabled={!enabled} onClick={() => void openEdit(row)}>Edit</Button>
                    ) : null}
                    {actions.has("submit") ? (
                      <Button size="small" aria-label={`Submit ${row.title} for review`} disabled={!enabled} onClick={() => queueWorkflow(row, "submit")}>Submit</Button>
                    ) : null}
                    {actions.has("approve") ? (
                      <Button size="small" aria-label={`Approve ${row.title}`} disabled={!enabled} onClick={() => queueWorkflow(row, "approve")}>Approve</Button>
                    ) : null}
                    {actions.has("reject") ? (
                      <Button size="small" aria-label={`Reject ${row.title}`} disabled={!enabled} onClick={() => queueWorkflow(row, "reject")}>Reject</Button>
                    ) : null}
                    {actions.has("publish") ? (
                      <Button size="small" aria-label={`Publish ${row.title}`} disabled={!enabled} onClick={() => queueWorkflow(row, "publish")}>Publish</Button>
                    ) : null}
                    {actions.has("unpublish") ? (
                      <Button size="small" aria-label={`Unpublish ${row.title}`} disabled={!enabled} onClick={() => queueWorkflow(row, "unpublish")}>Unpublish</Button>
                    ) : null}
                  </Box>
                );
              }}
              sort={sort}
              onSortChange={(next) => { setSort(next); setPage(1); }}
              loading={posts.loading}
              error={posts.error}
              onRetry={posts.reload}
              emptyState={<Typography role="status" color="text.secondary" sx={{ p: 3 }}>{activeFilterCount ? "No Posts match these filters." : "This Site does not have any Posts yet."}</Typography>}
            />
          </Box>
          {posts.data ? <Pagination page={page} count={posts.data.count} pageSize={PAGE_SIZE} onPageChange={setPage} label="Posts pagination" disabled={posts.loading} /> : null}
        </>
      ) : null}

      <Dialog open={editorOpen} onClose={() => { if (!saving) { setEditorOpen(false); setShowDraftPreview(false); } }} fullWidth maxWidth="md" aria-labelledby="post-editor-title">
        <DialogTitle id="post-editor-title">{activePost ? "Edit Post" : "Create Post"}</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
          {dialogError ? <Alert severity="error" role="alert">{dialogError}</Alert> : null}
          {blocksError(form) ? <Alert severity="error" role="alert">{blocksError(form)}</Alert> : null}
          {seoError(form.seo, siteId) ? <Alert severity="error" role="alert">{seoError(form.seo, siteId)}</Alert> : null}
          <TextField label="Title" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} required disabled={!enabled} autoFocus />
          <TextField label="Slug" value={form.slug} onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))} required disabled={!enabled} error={Boolean(slugError(form.slug))} helperText={slugError(form.slug) || "Use lowercase letters, numbers and hyphens."} />
          <TextField label="Excerpt" value={form.excerpt} onChange={(event) => setForm((current) => ({ ...current, excerpt: event.target.value }))} multiline minRows={2} disabled={!enabled} />
          <TextField label="Featured image reference" value={form.featured_media} onChange={(event) => setForm((current) => ({ ...current, featured_media: event.target.value }))} disabled={!enabled} error={Boolean(mediaReferenceError(form.featured_media.trim(), siteId))} helperText={mediaReferenceError(form.featured_media.trim(), siteId) || `Use sites/${siteId}/... or shared/... . The platform has no media upload or picker API yet.`} />
          <Box component="section" aria-label="Post content blocks" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <Typography variant="subtitle2">Content blocks</Typography>
            {form.blocks.map((block, index) => (
              <Paper key={`post-block-${index}`} variant="outlined" sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
                <Typography variant="caption">Block {index + 1} - same block format as Pages</Typography>
                <TextField label={`Block ${index + 1} JSON`} value={block} onChange={(event) => setForm((current) => ({ ...current, blocks: current.blocks.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} multiline minRows={3} fullWidth />
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                  <Button aria-label={`Move Post block ${index + 1} up`} disabled={index === 0 || !enabled} onClick={() => setForm((current) => { const blocks = [...current.blocks]; [blocks[index - 1], blocks[index]] = [blocks[index], blocks[index - 1]]; return { ...current, blocks }; })}>Move up</Button>
                  <Button aria-label={`Move Post block ${index + 1} down`} disabled={index === form.blocks.length - 1 || !enabled} onClick={() => setForm((current) => { const blocks = [...current.blocks]; [blocks[index + 1], blocks[index]] = [blocks[index], blocks[index + 1]]; return { ...current, blocks }; })}>Move down</Button>
                  <Button aria-label={`Remove Post block ${index + 1}`} disabled={!enabled} onClick={() => setForm((current) => ({ ...current, blocks: current.blocks.filter((_, itemIndex) => itemIndex !== index) }))}>Remove</Button>
                </Box>
              </Paper>
            ))}
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
              <Button disabled={!enabled} onClick={() => setForm((current) => ({ ...current, blocks: [...current.blocks, '{"type":"heading","level":2,"text":"New heading"}'] }))}>Add heading</Button>
              <Button disabled={!enabled} onClick={() => setForm((current) => ({ ...current, blocks: [...current.blocks, '{"type":"paragraph","html":"<p>New paragraph</p>"}'] }))}>Add paragraph</Button>
              <Button disabled={!enabled} onClick={() => setForm((current) => ({ ...current, blocks: [...current.blocks, JSON.stringify({ type: "image", alt: "Describe this image", ref: `sites/${siteId}/image` })] }))}>Add image</Button>
              <Button disabled={!enabled} onClick={() => setForm((current) => ({ ...current, blocks: [...current.blocks, '{"type":"button","label":"Learn more","href":"/"}'] }))}>Add button</Button>
              <Button disabled={!enabled} onClick={() => setForm((current) => ({ ...current, blocks: [...current.blocks, '{"type":"list","style":"unordered","items":["First item"]}'] }))}>Add list</Button>
              <Button disabled={!enabled} onClick={() => setForm((current) => ({ ...current, blocks: [...current.blocks, '{"type":"section","heading":"New section","children":[]}'] }))}>Add section</Button>
            </Box>
          </Box>
          <TextField label="SEO metadata (JSON object)" value={form.seo} onChange={(event) => setForm((current) => ({ ...current, seo: event.target.value }))} multiline minRows={3} disabled={!enabled} helperText="Allowed keys: meta_title, meta_description and og_image_ref." />
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
            <Box>
            <FormControl fullWidth>
              <InputLabel id="post-categories-label">Categories</InputLabel>
              <Select multiple labelId="post-categories-label" label="Categories" value={form.categories} input={<OutlinedInput label="Categories" />} disabled={!enabled || taxonomy.loading} renderValue={(selected) => selected.map((id) => categoryNames.get(id) ?? "Category").join(", ")} onChange={(event) => setForm((current) => ({ ...current, categories: typeof event.target.value === "string" ? event.target.value.split(",") : event.target.value }))}>
                {categories.map((row) => <MenuItem key={row.id} value={row.id}><ListItemText primary={row.name} /></MenuItem>)}
              </Select>
            </FormControl>
            {canCreate ? <Button disabled={!enabled} onClick={() => openTaxonomy("categories")}>Create category</Button> : null}
            </Box>
            <Box>
            <FormControl fullWidth>
              <InputLabel id="post-tags-label">Tags</InputLabel>
              <Select multiple labelId="post-tags-label" label="Tags" value={form.tags} input={<OutlinedInput label="Tags" />} disabled={!enabled || taxonomy.loading} renderValue={(selected) => selected.map((id) => tagNames.get(id) ?? "Tag").join(", ")} onChange={(event) => setForm((current) => ({ ...current, tags: typeof event.target.value === "string" ? event.target.value.split(",") : event.target.value }))}>
                {tags.map((row) => <MenuItem key={row.id} value={row.id}><ListItemText primary={row.name} /></MenuItem>)}
              </Select>
            </FormControl>
            {canCreate ? <Button disabled={!enabled} onClick={() => openTaxonomy("tags")}>Create tag</Button> : null}
            </Box>
          </Box>
          <Button onClick={() => setShowDraftPreview((value) => !value)} aria-expanded={showDraftPreview}>{showDraftPreview ? "Hide preview" : "Preview draft"}</Button>
          {showDraftPreview ? (
            <Paper variant="outlined" sx={{ p: 2 }} role="region" aria-label="Private Post preview">
              <Typography variant="overline">Private draft preview</Typography>
              {(() => {
                try {
                  return <PublicPageView page={{ title: form.title || "Untitled Post", path: `/${form.slug}`, blocks: parsedBlocks(form) }} />;
                } catch (cause) {
                  return <Alert severity="error">{cause instanceof Error ? cause.message : "Fix block errors to preview this Post."}</Alert>;
                }
              })()}
            </Paper>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", px: 3, pb: 2 }}>
          <Button onClick={() => { setEditorOpen(false); setShowDraftPreview(false); }} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={() => void savePost()} disabled={!enabled || !form.title.trim() || !form.slug.trim() || Boolean(slugError(form.slug)) || Boolean(blocksError(form)) || Boolean(seoError(form.seo, siteId)) || Boolean(mediaReferenceError(form.featured_media.trim(), siteId)) || (activePost ? !canEdit : !canCreate)}>
            {saving ? "Saving…" : activePost ? "Save changes" : "Create draft"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={pendingWorkflow !== null} onClose={() => { if (busyPostId === null) setPendingWorkflow(null); }} fullWidth maxWidth="sm" aria-labelledby="post-workflow-title">
        <DialogTitle id="post-workflow-title">Confirm {pendingWorkflow?.action}</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
          <Typography>
            {pendingWorkflow ? `Confirm ${pendingWorkflow.action} for “${pendingWorkflow.post.title}”. This changes the Post on this Site only.` : ""}
          </Typography>
          {pendingWorkflow?.action === "reject" ? (
            <TextField label="Review comment" value={workflowComment} onChange={(event) => setWorkflowComment(event.target.value)} required multiline minRows={2} />
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingWorkflow(null)} disabled={busyPostId !== null}>Cancel</Button>
          <Button variant="contained" onClick={() => void confirmWorkflow()} disabled={!enabled || (pendingWorkflow?.action === "reject" && !workflowComment.trim())}>
            Confirm
          </Button>
        </DialogActions>
      </Dialog>

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
    </Paper>
  );
}
