"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AddIcon from "@mui/icons-material/Add";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { ApiError } from "@uog/api-client";
import {
  DataTable,
  FilterBar,
  Pagination,
  PublicPageView,
  pageFromResponse,
  SelectFilter,
  TextFilter,
  useAsync,
  useToast,
} from "@uog/ui";
import type {
  SortState,
  TableColumn,
} from "@uog/ui";

import {
  getSitePage,
  getSitePagePreview,
  loadSitePages,
  loadSitePageStatusCounts,
  loadSitePageWorkflowHistory,
  openWorkingDraft,
  setSiteHomepage,
  transitionSitePage,
} from "@/app/sites/page-actions";
import type {
  SitePageListQuery,
  SitePageListResponse,
  SitePageRecord,
  SitePageStatus,
  SitePageWorkflowAction,
  SitePageWorkflowTransition,
  SitePagePreview,
} from "@/app/sites/page-actions";
import { unwrap } from "@/organizations/contract";
import { APP_BASE_PATH } from "@/base-path";
import { ContentWorkflowButtons, ContentWorkflowDialog } from "@/sites/content-workflow";
import type { WorkflowAction } from "@/sites/content-workflow";
import type { PageLanguages } from "@/sites/site-page-editor";

export type { PageLanguages };

const PAGE_SIZE = 20;
const STATUSES: readonly SitePageStatus[] = [
  "DRAFT",
  "IN_REVIEW",
  "APPROVED",
  "PUBLISHED",
  "UNPUBLISHED",
  "ARCHIVED",
];
const STATUS_LABELS: Record<SitePageStatus, string> = {
  DRAFT: "Draft",
  IN_REVIEW: "In review",
  APPROVED: "Approved",
  PUBLISHED: "Published",
  UNPUBLISHED: "Unpublished",
  ARCHIVED: "Archived",
};
const STATUS_COLORS: Record<SitePageStatus, "default" | "success" | "warning" | "info"> = {
  DRAFT: "default",
  IN_REVIEW: "info",
  APPROVED: "info",
  PUBLISHED: "success",
  UNPUBLISHED: "warning",
  ARCHIVED: "default",
};
const PERMISSIONS = {
  view: "content.pages.view",
  create: "content.pages.create",
  update: "content.pages.update",
} as const;
const EMPTY_PAGE_LIST = {
  count: 0,
  next: null,
  previous: null,
  results: [] as SitePageRecord[],
};
const EMPTY_STATUS_COUNTS: Record<SitePageStatus, number> = {
  DRAFT: 0,
  IN_REVIEW: 0,
  APPROVED: 0,
  PUBLISHED: 0,
  UNPUBLISHED: 0,
  ARCHIVED: 0,
};

interface PageFilters {
  search: string;
  status: SitePageStatus | "";
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function authorLabel(author: SitePageRecord["created_by"]): string {
  return author == null ? "—" : `User ${author}`;
}

function orderingForSort(sort: SortState): SitePageListQuery["ordering"] {
  if (sort.field === "title") return sort.direction === "desc" ? "-title" : "title";
  return sort.direction === "desc" ? "-updated_at" : "updated_at";
}

export function SitePagesPanel({
  siteId,
  pagesEnabled,
  builderEnabled = null,
  permissions = [],
  languages,
  visualBuilderMode = false,
}: {
  siteId: number;
  pagesEnabled: boolean | null;
  /** VISUAL_BUILDER Site module. Builder actions stay hidden when false. */
  builderEnabled?: boolean | null;
  permissions?: readonly string[];
  languages?: PageLanguages;
  visualBuilderMode?: boolean;
}) {
  return (
    <SitePagesPanelContent
      key={siteId}
      siteId={siteId}
      pagesEnabled={pagesEnabled}
      builderEnabled={builderEnabled}
      permissions={permissions}
      languages={languages}
      visualBuilderMode={visualBuilderMode}
    />
  );
}

function SitePagesPanelContent({
  siteId,
  pagesEnabled,
  builderEnabled,
  permissions,
  visualBuilderMode,
}: {
  siteId: number;
  pagesEnabled: boolean | null;
  builderEnabled: boolean | null;
  permissions: readonly string[];
  languages?: PageLanguages;
  visualBuilderMode: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const canView = permissions.includes(PERMISSIONS.view);
  const canCreate = permissions.includes(PERMISSIONS.create);
  const canEdit = permissions.includes(PERMISSIONS.update);
  const [draftFilters, setDraftFilters] = useState<PageFilters>({ search: "", status: "" });
  const [appliedFilters, setAppliedFilters] = useState<PageFilters>({ search: "", status: "" });
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ field: "updated_at", direction: "desc" });
  const [reviewQueue, setReviewQueue] = useState(false);
  const [pendingWorkflow, setPendingWorkflow] = useState<{ page: SitePageRecord; action: SitePageWorkflowAction } | null>(null);
  const [workflowComment, setWorkflowComment] = useState("");
  const [workflowError, setWorkflowError] = useState("");
  const [historyPage, setHistoryPage] = useState<SitePageRecord | null>(null);
  const [workflowHistory, setWorkflowHistory] = useState<SitePageWorkflowTransition[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [workflowPreview, setWorkflowPreview] = useState<SitePagePreview | null>(null);
  const workflowSequence = useRef(0);
  const [busyPageId, setBusyPageId] = useState<string | null>(null);

  const ordering = orderingForSort(sort);
  const pages = useAsync<SitePageListResponse>(
    async () => canView
      ? unwrap(await loadSitePages(siteId, {
          search: appliedFilters.search || undefined,
          status: appliedFilters.status || undefined,
          page,
          page_size: PAGE_SIZE,
          ordering,
        }))
      : EMPTY_PAGE_LIST,
    [siteId, canView, appliedFilters.search, appliedFilters.status, page, ordering],
    { isEmpty: (data) => data.count === 0 },
  );
  const statusCounts = useAsync<Record<SitePageStatus, number>>(
    async () => canView
      ? unwrap(await loadSitePageStatusCounts(siteId))
      : EMPTY_STATUS_COUNTS,
    [siteId, canView],
  );

  const rows = (pages.data?.results ?? []).filter((row) => row.site === siteId);
  const enabled = pagesEnabled === true && !saving && busyPageId === null;
  const activeFilterCount = Number(Boolean(appliedFilters.search)) + Number(Boolean(appliedFilters.status));

  function applyFilters() {
    setAppliedFilters({
      search: draftFilters.search.trim(),
      status: draftFilters.status,
    });
    setPage(1);
  }

  function resetFilters() {
    setReviewQueue(false);
    setDraftFilters({ search: "", status: "" });
    setAppliedFilters({ search: "", status: "" });
    setPage(1);
  }

  async function openPublishedDraft(row: SitePageRecord) {
    setSaving(true);
    try {
      const current = unwrap(await getSitePage(siteId, row.id));
      const opened = unwrap(await openWorkingDraft(siteId, row.id, current.etag ?? ""));
      if (opened.status !== "DRAFT") {
        toast.success("This Page already has a draft in review. Continue from its workflow actions.");
        pages.reload();
        return;
      }
      router.push(`/sites/${siteId}/admin/pages/${opened.id}/edit`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "The working draft could not be opened.");
    } finally {
      setSaving(false);
    }
  }

  async function runPageAction(row: SitePageRecord, action: () => Promise<unknown>): Promise<boolean> {
    setBusyPageId(row.id);
    try {
      await action();
      pages.reload();
      statusCounts.reload();
      return true;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        toast.error("The Page workflow changed before this action completed. Refreshing the current status.");
        pages.reload();
        statusCounts.reload();
      } else {
        const details = cause instanceof ApiError && cause.fieldErrors ? [...new Set(Object.values(cause.fieldErrors).flat())].join(" ") : "";
        const message = details || (cause instanceof Error ? cause.message : "The Page could not be updated.");
        if (pendingWorkflow) setWorkflowError(message);
        toast.error(message);
      }
      return false;
    } finally {
      setBusyPageId(null);
    }
  }

  async function openWorkflowHistory(row: SitePageRecord) {
    setHistoryPage(row);
    setWorkflowHistory([]);
    setHistoryError("");
    setHistoryLoading(true);
    try {
      const result = unwrap(await loadSitePageWorkflowHistory(siteId, row.id));
      setWorkflowHistory(result);
    } catch (cause) {
      setHistoryError(cause instanceof Error ? cause.message : "Workflow history could not be loaded.");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function queueWorkflowAction(row: SitePageRecord, action: WorkflowAction) {
    const sequence = ++workflowSequence.current;
    setWorkflowComment("");
    setWorkflowError("");
    setWorkflowPreview(null);
    setPendingWorkflow({ page: row, action });
    if (row.metadata?.visual_layout && (action === "approve" || action === "publish" || action === "revise")) {
      setBusyPageId(row.id);
      try {
        const preview = unwrap(await getSitePagePreview(siteId, row.id, row.revision_number));
        if (sequence !== workflowSequence.current) return;
        setWorkflowPreview(preview);
        setPendingWorkflow({ page: { ...row, etag: preview.etag }, action });
      } catch (cause) {
        if (sequence === workflowSequence.current) {
          toast.error(cause instanceof Error ? cause.message : "Revision preview could not be loaded.");
          setPendingWorkflow(null);
        }
      } finally {
        if (sequence === workflowSequence.current) setBusyPageId(null);
      }
    }
  }

  async function confirmWorkflowAction() {
    if (!pendingWorkflow) return;
    const { page: row, action } = pendingWorkflow;
    const succeeded = await runPageAction(row, async () => unwrap(await (row.metadata?.visual_layout
      ? transitionSitePage(siteId, row.id, action, workflowComment.trim(), row.etag)
      : transitionSitePage(siteId, row.id, action, workflowComment.trim()))));
    if (succeeded) setPendingWorkflow(null);
  }

  const columns: TableColumn<SitePageRecord>[] = [
    {
      field: "title",
      header: "Title",
      sortable: true,
      render: (row) => (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography component="span" sx={{ fontWeight: 600 }}>{row.title}</Typography>
          {row.is_homepage ? <Chip size="small" label="Homepage" color="primary" variant="outlined" /> : null}
        </Box>
      ),
    },
    { field: "path", header: "Path", render: (row) => row.path },
    {
      field: "status",
      header: "Status",
      render: (row) => (
        <Chip
          size="small"
          label={STATUS_LABELS[row.status]}
          color={STATUS_COLORS[row.status]}
          variant="outlined"
        />
      ),
    },
    { field: "created_by", header: "Author", render: (row) => authorLabel(row.created_by) },
    {
      field: "updated_at",
      header: "Updated",
      sortable: true,
      render: (row) => formatUpdatedAt(row.updated_at),
    },
    { field: "locale", header: "Locale", render: (row) => row.locale || "—" },
  ];

  function renderActions(row: SitePageRecord) {
    const actions = [
      <Button
        key="preview"
        component={Link}
        href={`/sites/${siteId}/admin/pages/${row.id}/preview${row.revision_number ? `?revision=${row.revision_number}` : ""}`}
        target="_blank"
        rel="noopener noreferrer"
        size="small"
        aria-label={`Preview ${row.title}`}
      >
        Preview
      </Button>,
      <Button key="history" size="small" aria-label={`Workflow history for ${row.title}`} onClick={() => void openWorkflowHistory(row)}>
        History
      </Button>,
    ];

    if (canEdit && (row.status === "DRAFT" || row.status === "UNPUBLISHED")) {
      actions.push(
        <Button
          key="edit"
          component={Link}
          href={`/sites/${siteId}/admin/pages/${row.id}/edit`}
          size="small"
          aria-label={`Edit ${row.title}`}
          disabled={!enabled}
        >
          Edit
        </Button>,
      );
    }
    if (
      canEdit
      && builderEnabled === true
      && ["DRAFT", "UNPUBLISHED", "PUBLISHED"].includes(row.status)
    ) {
      actions.push(
        <Button key="builder" component={Link} href={`/sites/${siteId}/admin/pages/${row.id}/builder`} size="small" disabled={!enabled} aria-label={`Open Visual Builder for ${row.title}`}>
          Visual Builder
        </Button>,
      );
    }
    if (canEdit && row.status === "PUBLISHED" && !row.draft_of) {
      actions.push(
        <Button key="working-draft" size="small" aria-label={`Edit a draft of ${row.title}`} disabled={!enabled} onClick={() => void openPublishedDraft(row)}>
          Edit draft
        </Button>,
      );
    }
    actions.push(
      <ContentWorkflowButtons
        key="workflow"
        title={row.title}
        available={row.available_actions ?? []}
        disabled={!enabled}
        onAction={(action) => queueWorkflowAction(row, action)}
      />,
    );
    if (
      row.can_set_homepage && row.status === "PUBLISHED" &&
      !row.is_homepage
    ) {
      actions.push(
        <Button
          key="homepage"
          size="small"
          aria-label={`Set ${row.title} as homepage`}
          disabled={!enabled}
          onClick={() => void runPageAction(row, async () => {
            unwrap(await setSiteHomepage(siteId, row.id));
            toast.success(`Homepage assigned: ${row.title}`);
          })}
        >
          Set homepage
        </Button>,
      );
    }

    return (
      <Box
        role="group"
        aria-label={`Actions for ${row.title}`}
        sx={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 0.5 }}
      >
        {actions}
      </Box>
    );
  }

  return (
    <Paper
      variant="outlined"
      sx={{ borderRadius: 3, p: { xs: 2, sm: 3 }, display: "flex", flexDirection: "column", gap: 2 }}
    >
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
        <Box>
          <Typography variant="h2" component="h2" sx={{ fontSize: "1.25rem", fontWeight: 700 }}>{visualBuilderMode ? "Visual Builder" : "Pages"}</Typography>
          <Typography variant="body2" color="text.secondary">
            {visualBuilderMode ? "Choose a Page below and select Visual Builder. Published Pages open through a private working draft; Pages in review stay locked." : "Manage the Pages belonging to this Site."}
          </Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          {permissions.includes("sites.update") && !visualBuilderMode ? (
            <Button component={Link} href={`/sites/${siteId}/admin/homepage`} variant="outlined" disabled={!enabled}>
              Homepage Settings
            </Button>
          ) : null}
          {canCreate ? (
            <Button
              component={Link}
              href={`/sites/${siteId}/admin/pages/new`}
              variant="contained"
              startIcon={<AddIcon />}
              disabled={!enabled}
            >
              Create page
            </Button>
          ) : null}
        </Box>
      </Box>

      {pagesEnabled === null ? (
        <Typography variant="body2" color="text.secondary" aria-live="polite">
          Checking the PAGES module…
        </Typography>
      ) : null}
      {pagesEnabled === false ? (
        <Alert severity="warning">
          Pages are off for this Site. Create, edit and workflow changes are blocked. Existing Pages are preserved.
        </Alert>
      ) : null}
      {visualBuilderMode && builderEnabled === false ? (
        <Alert severity="warning">
          Visual Builder is off for this Site. Enable the VISUAL_BUILDER module to compose visual Pages. Existing layouts are preserved.
        </Alert>
      ) : null}
      {!canView ? (
        <Alert severity="warning">You do not have permission to view Pages for this Site.</Alert>
      ) : (
        <>
          <Box component="section" aria-labelledby="page-status-heading">
            <Typography id="page-status-heading" component="h3" variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
              Page status dashboard
            </Typography>
            {statusCounts.error ? (
              <Alert severity="error">
                Status totals could not be loaded: {statusCounts.error.message}
              </Alert>
            ) : statusCounts.loading ? (
              <Typography variant="body2" color="text.secondary" aria-live="polite">
                Loading page status totals…
              </Typography>
            ) : statusCounts.data ? (
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 1 }}>
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">Total</Typography>
                  <Typography variant="h6">
                    {Object.values(statusCounts.data).reduce((total, count) => total + count, 0)}
                  </Typography>
                </Paper>
                {STATUSES.map((status) => (
                  <Paper key={status} variant="outlined" sx={{ p: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">{STATUS_LABELS[status]}</Typography>
                    <Typography variant="h6">{statusCounts.data?.[status] ?? 0}</Typography>
                  </Paper>
                ))}
              </Box>
            ) : null}
          </Box>

          <FilterBar
            label="Page filters"
            activeCount={activeFilterCount}
            onApply={applyFilters}
            onReset={resetFilters}
            resetDisabled={pages.loading && !pages.data}
          >
            <TextFilter
              label="Search Pages"
              placeholder="Title or slug"
              value={draftFilters.search}
              onChange={(search) => setDraftFilters((current) => ({ ...current, search }))}
            />
            <SelectFilter
              label="Status"
              value={draftFilters.status}
              options={STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] }))}
              onChange={(status) => setDraftFilters((current) => ({
                ...current,
                status: STATUSES.find((candidate) => candidate === status) ?? "",
              }))}
            />
          </FilterBar>

          <Button
            variant={reviewQueue ? "contained" : "outlined"}
            aria-pressed={reviewQueue}
            onClick={() => {
              const next = !reviewQueue;
              setReviewQueue(next);
              setDraftFilters((current) => ({ ...current, status: next ? "IN_REVIEW" : "" }));
              setAppliedFilters((current) => ({ ...current, status: next ? "IN_REVIEW" : "" }));
              setPage(1);
            }}
          >
            {reviewQueue ? "Show all Pages" : "Review queue"}
          </Button>

          <Box sx={{ overflowX: "auto" }}>
            <DataTable
              caption="Pages for this Site"
              columns={columns}
              rows={rows}
              getRowKey={(row) => row.id}
              renderActions={renderActions}
              sort={sort}
              onSortChange={(nextSort) => {
                setSort(nextSort);
                setPage(1);
              }}
              loading={pages.loading}
              error={pages.error}
              onRetry={pages.reload}
              emptyState={
                <Typography role="status" color="text.secondary" sx={{ p: 3 }}>
                  {activeFilterCount > 0
                    ? "No Pages match these filters."
                    : "This Site does not have any Pages yet."}
                </Typography>
              }
            />
          </Box>

          {pages.data ? (
            <Pagination
              page={page}
              count={pages.data.count}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
              label="Pages pagination"
              disabled={pages.loading}
            />
          ) : null}
        </>
      )}

      <ContentWorkflowDialog
        noun="Page"
        action={pendingWorkflow?.action ?? null}
        title={pendingWorkflow?.page.title ?? ""}
        comment={workflowComment}
        error={workflowError}
        busy={busyPageId !== null || !enabled}
        onComment={setWorkflowComment}
        onClose={() => setPendingWorkflow(null)}
        onConfirm={() => void confirmWorkflowAction()}
      >
        {workflowPreview && pendingWorkflow ? <Box><Typography variant="overline">Private revision {workflowPreview.revision_number}</Typography><PublicPageView page={pageFromResponse(200, workflowPreview.page)} privateMediaBase={`${APP_BASE_PATH}/sites/${siteId}/pages/${pendingWorkflow.page.id}/preview-media/${workflowPreview.revision_number}`} /></Box> : null}
      </ContentWorkflowDialog>

      <Dialog
        open={historyPage !== null}
        onClose={() => setHistoryPage(null)}
        fullWidth maxWidth="sm"
        aria-labelledby="page-workflow-history-title"
      >
        <DialogTitle id="page-workflow-history-title">Workflow history: {historyPage?.title}</DialogTitle>
        <DialogContent dividers>
          {historyLoading ? <Typography role="status">Loading workflow history…</Typography> : null}
          {historyError ? <Alert severity="error" role="alert">{historyError}</Alert> : null}
          {!historyLoading && !historyError && workflowHistory.length === 0 ? <Typography color="text.secondary">No workflow transitions have been recorded.</Typography> : null}
          <Box component="ol" aria-label="Page status timeline" sx={{ m: 0, pl: 3 }}>
            {workflowHistory.map((transition) => (
              <Box component="li" key={transition.id} sx={{ mb: 2 }}>
                <Typography fontWeight={600}>{STATUS_LABELS[transition.from_status]} → {STATUS_LABELS[transition.to_status]}</Typography>
                <Typography variant="body2" color="text.secondary">{formatUpdatedAt(transition.created_at)} · {transition.actor == null ? "Former user" : `User ${transition.actor}`}</Typography>
                {transition.comment ? <Typography sx={{ mt: 0.5, whiteSpace: "pre-wrap" }}>{transition.comment}</Typography> : null}
              </Box>
            ))}
          </Box>
        </DialogContent>
        <DialogActions><Button onClick={() => setHistoryPage(null)}>Close</Button></DialogActions>
      </Dialog>
    </Paper>
  );
}
