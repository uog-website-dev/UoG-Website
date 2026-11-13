"use client";

import { useMemo, useState } from "react";
import AddIcon from "@mui/icons-material/Add";
import Alert from "@mui/material/Alert";
import { APP_BASE_PATH } from "@/base-path";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { ApiError } from "@uog/api-client";
import {
  DataTable, FilterBar, Pagination, SelectFilter, TextFilter, useAsync, useToast,
} from "@uog/ui";
import type { SortState, TableColumn } from "@uog/ui";
import Link from "next/link";

import {
  loadSitePostWorkflowHistory,
  loadSitePosts,
  loadSiteTaxonomy,
  transitionSitePost,
} from "@/app/sites/post-actions";
import type {
  SitePostListQuery,
  SitePostListResponse,
  SitePostRecord,
  SitePostStatus,
  SitePostWorkflowAction,
  SiteTaxonomyRecord,
} from "@/app/sites/post-actions";
import { unwrap } from "@/organizations/contract";
import { ContentWorkflowButtons, ContentWorkflowDialog, ContentWorkflowHistory } from "@/sites/content-workflow";
import type { WorkflowAction, WorkflowTransition } from "@/sites/content-workflow";

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
  mediaEnabled = false,
  permissions = [],
}: {
  siteId: number;
  postsEnabled: boolean | null;
  mediaEnabled?: boolean;
  permissions?: readonly string[];
}) {
  return (
    <SitePostsPanelContent
      key={siteId}
      siteId={siteId}
      postsEnabled={postsEnabled}
      mediaEnabled={mediaEnabled}
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
  mediaEnabled: boolean;
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
  const [pendingWorkflow, setPendingWorkflow] = useState<{ post: SitePostRecord; action: SitePostWorkflowAction } | null>(null);
  const [workflowComment, setWorkflowComment] = useState("");
  const [workflowError, setWorkflowError] = useState("");
  const [busyPostId, setBusyPostId] = useState<string | null>(null);
  const [historyPost, setHistoryPost] = useState<SitePostRecord | null>(null);
  const [history, setHistory] = useState<WorkflowTransition[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);

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
  const enabled = postsEnabled === true && busyPostId === null;
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

  function queueWorkflow(row: SitePostRecord, action: WorkflowAction) {
    if (!enabled || action === "revise") return;
    setWorkflowComment("");
    setWorkflowError("");
    setPendingWorkflow({ post: row, action });
  }

  async function openHistory(row: SitePostRecord) {
    setHistoryPost(row);
    setHistory([]);
    setHistoryError("");
    setHistoryLoading(true);
    try {
      setHistory(unwrap(await loadSitePostWorkflowHistory(siteId, row.id)));
    } catch (cause) {
      setHistoryError(apiErrorText(cause, "Workflow history could not be loaded."));
    } finally {
      setHistoryLoading(false);
    }
  }

  async function confirmWorkflow() {
    if (!pendingWorkflow || !enabled) return;
    const { post: row, action } = pendingWorkflow;
    if (action === "reject" && !workflowComment.trim()) return;
    setBusyPostId(row.id);
    setWorkflowError("");
    try {
      unwrap(await transitionSitePost(siteId, row.id, action, workflowComment.trim()));
      setPendingWorkflow(null);
      posts.reload();
      toast.success(`Post ${action} completed.`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) posts.reload();
      setWorkflowError(apiErrorText(cause, "The Post workflow could not be updated."));
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
          <Typography variant="caption" color="text.secondary">{row.draft_of ? `Working draft of /posts/${row.publication_slug}` : `/${row.slug}`}</Typography>
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
      render: (row) => row.categories.map((id) => categoryNames.get(id) ?? (taxonomy.loading ? "Loading category..." : `Unavailable category (${id})`)).join(", ") || "—",
    },
    { field: "tags", header: "Tags", render: (row) => row.tags.map((id) => tagNames.get(id) ?? (taxonomy.loading ? "Loading tag..." : `Unavailable tag (${id})`)).join(", ") || "—" },
    {
      field: "published_at", header: "Published", sortable: true,
      render: (row) => row.published_at ? formatDate(row.published_at) : "Not published",
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
        {canCreate && postsEnabled === true ? (
          <Button
            component={Link}
            href={`/sites/${siteId}/admin/posts/new`}
            variant="contained"
            startIcon={<AddIcon />}
            disabled={!enabled}
          >
            Create Post
          </Button>
        ) : null}
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
              renderActions={(row) => (
                <Box role="group" aria-label={`Actions for ${row.title}`} sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                  <Button size="small" aria-label={`Workflow history for ${row.title}`} onClick={() => void openHistory(row)}>History</Button>
                  {canEdit || Boolean(row.available_actions?.length) ? (
                    <Button
                      component={Link}
                      href={`/sites/${siteId}/admin/posts/${row.id}/edit`}
                      size="small"
                      aria-label={`${canEdit ? "Edit" : "Review"} ${row.title}`}
                      disabled={!enabled}
                    >
                      {canEdit ? "Edit" : "Review"}
                    </Button>
                  ) : null}
                  {postsEnabled === true ? (
                    <ContentWorkflowButtons
                      title={row.title}
                      available={row.available_actions ?? []}
                      disabled={!enabled}
                      onAction={(action) => queueWorkflow(row, action)}
                    />
                  ) : null}
                </Box>
              )}
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

      <ContentWorkflowDialog
        noun="Post"
        action={pendingWorkflow?.action ?? null}
        title={pendingWorkflow?.post.title ?? ""}
        comment={workflowComment}
        error={workflowError}
        busy={busyPostId !== null}
        onComment={setWorkflowComment}
        onClose={() => { if (busyPostId === null) setPendingWorkflow(null); }}
        onConfirm={() => void confirmWorkflow()}
      />
      <ContentWorkflowHistory
        title={historyPost?.title ?? ""}
        open={historyPost !== null}
        loading={historyLoading}
        error={historyError}
        transitions={history}
        formatWhen={formatDate}
        statusLabel={(status) => STATUS_LABELS[status as SitePostStatus] ?? status}
        onClose={() => setHistoryPost(null)}
      />
    </Paper>
  );
}
