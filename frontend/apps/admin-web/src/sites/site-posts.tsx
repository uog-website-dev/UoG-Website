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
  DataTable,
  FilterBar,
  Pagination,
  SelectFilter,
  TextFilter,
  useAsync,
  useToast,
} from "@uog/ui";
import type { SortState, TableColumn } from "@uog/ui";

import {
  createSitePost,
  getSitePost,
  loadSitePosts,
  loadSiteTaxonomy,
  updateSitePost,
} from "@/app/sites/post-actions";
import type {
  SitePostListQuery,
  SitePostListResponse,
  SitePostRecord,
  SitePostStatus,
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
  content: string;
  featured_media: string;
  categories: string[];
  tags: string[];
}

function emptyForm(): PostForm {
  return { title: "", slug: "", excerpt: "", content: "", featured_media: "", categories: [], tags: [] };
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
  const enabled = postsEnabled === true && !saving;
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
        content: current.content,
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
    const input = {
      title: form.title.trim(),
      slug: form.slug.trim(),
      excerpt: form.excerpt.trim(),
      content: form.content,
      featured_media: form.featured_media.trim(),
      categories: form.categories,
      tags: form.tags,
    };
    try {
      if (activePost) {
        if (!activePost.etag) throw new Error("The Post revision is unavailable. Reopen the editor and retry.");
        unwrap(await updateSitePost(siteId, activePost.id, activePost.etag, input));
      } else {
        unwrap(await createSitePost(siteId, input));
      }
      setEditorOpen(false);
      setActivePost(null);
      posts.reload();
      toast.success(activePost ? "Post updated." : "Draft Post created.");
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setDialogError(`${cause.message} Reload the Post before saving again.`);
      } else {
        setDialogError(cause instanceof Error ? cause.message : "The Post could not be saved.");
      }
    } finally {
      setSaving(false);
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
        {canCreate ? <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} disabled={!enabled}>Create Post</Button> : null}
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
              renderActions={(row) => canEdit ? (
                <Button size="small" aria-label={`Edit ${row.title}`} disabled={!enabled} onClick={() => void openEdit(row)}>Edit</Button>
              ) : null}
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

      <Dialog open={editorOpen} onClose={() => { if (!saving) setEditorOpen(false); }} fullWidth maxWidth="md" aria-labelledby="post-editor-title">
        <DialogTitle id="post-editor-title">{activePost ? "Edit Post" : "Create Post"}</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
          {dialogError ? <Alert severity="error" role="alert">{dialogError}</Alert> : null}
          <TextField label="Title" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} required disabled={!enabled} autoFocus />
          <TextField label="Slug" value={form.slug} onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))} required disabled={!enabled} helperText="Use lowercase letters, numbers and hyphens." />
          <TextField label="Excerpt" value={form.excerpt} onChange={(event) => setForm((current) => ({ ...current, excerpt: event.target.value }))} multiline minRows={2} disabled={!enabled} />
          <TextField label="Post content" value={form.content} onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))} multiline minRows={6} required disabled={!enabled} />
          <TextField label="Featured image URL or path" value={form.featured_media} onChange={(event) => setForm((current) => ({ ...current, featured_media: event.target.value }))} disabled={!enabled} />
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
            <FormControl fullWidth>
              <InputLabel id="post-categories-label">Categories</InputLabel>
              <Select multiple labelId="post-categories-label" label="Categories" value={form.categories} input={<OutlinedInput label="Categories" />} disabled={!enabled || taxonomy.loading} renderValue={(selected) => selected.map((id) => categoryNames.get(id) ?? "Category").join(", ")} onChange={(event) => setForm((current) => ({ ...current, categories: typeof event.target.value === "string" ? event.target.value.split(",") : event.target.value }))}>
                {categories.map((row) => <MenuItem key={row.id} value={row.id}><ListItemText primary={row.name} /></MenuItem>)}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel id="post-tags-label">Tags</InputLabel>
              <Select multiple labelId="post-tags-label" label="Tags" value={form.tags} input={<OutlinedInput label="Tags" />} disabled={!enabled || taxonomy.loading} renderValue={(selected) => selected.map((id) => tagNames.get(id) ?? "Tag").join(", ")} onChange={(event) => setForm((current) => ({ ...current, tags: typeof event.target.value === "string" ? event.target.value.split(",") : event.target.value }))}>
                {tags.map((row) => <MenuItem key={row.id} value={row.id}><ListItemText primary={row.name} /></MenuItem>)}
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: "wrap", px: 3, pb: 2 }}>
          <Button onClick={() => setEditorOpen(false)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={() => void savePost()} disabled={!enabled || !form.title.trim() || !form.slug.trim() || !form.content.trim() || (activePost ? !canEdit : !canCreate)}>
            {saving ? "Saving…" : activePost ? "Save changes" : "Create draft"}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
