"use client";

import { useState } from "react";
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
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { ApiError } from "@uog/api-client";
import {
  DataTable,
  FilterBar,
  Pagination,
  PublicPageView,
  SelectFilter,
  TextFilter,
  useAsync,
  useToast,
} from "@uog/ui";
import type {
  PublicPageDocument,
  SortState,
  TableColumn,
} from "@uog/ui";

import {
  createSitePage,
  getSitePage,
  loadSitePages,
  loadSitePageStatusCounts,
  setSiteHomepage,
  transitionSitePage,
  updateSitePage,
} from "@/app/sites/page-actions";
import type {
  SitePageListQuery,
  SitePageListResponse,
  SitePageBlock,
  SitePageRecord,
  SitePageStatus,
} from "@/app/sites/page-actions";
import { unwrap } from "@/organizations/contract";

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
  publish: "content.pages.publish",
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

type DialogMode = "create" | "edit" | "preview";

interface PageFilters {
  search: string;
  status: SitePageStatus | "";
}

interface PageForm {
  title: string;
  slug: string;
  parent: string;
  locale: string;
  visibility: SitePageRecord["visibility"];
  metadata: string;
  seo: string;
  blocks: string[];
}

function previewOf(page: SitePageRecord): PublicPageDocument {
  return {
    title: page.title,
    path: page.path,
    blocks: page.blocks,
  };
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

function emptyForm(): PageForm {
  return {
    title: "", slug: "", parent: "", locale: "en", visibility: "PUBLIC",
    metadata: "{}", seo: "{}", blocks: ['{"type":"paragraph","html":"<p>Applications are open.</p>"}'],
  };
}

function blockInputs(form: PageForm): SitePageBlock[] {
  return form.blocks.map((raw) => JSON.parse(raw) as SitePageBlock);
}

function metadataInput(form: PageForm): Record<string, unknown> {
  return jsonObject(form.metadata, "Metadata");
}

function jsonObject(source: string, label: string): Record<string, unknown> {
  const value: unknown = JSON.parse(source);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function formSyntaxError(form: PageForm): string | null {
  try {
    metadataInput(form);
    jsonObject(form.seo, "SEO metadata");
    blockInputs(form);
  } catch (error) {
    return error instanceof Error ? error.message : "Correct the JSON fields before saving.";
  }
  return null;
}

function orderingForSort(sort: SortState): SitePageListQuery["ordering"] {
  if (sort.field === "title") return sort.direction === "desc" ? "-title" : "title";
  return sort.direction === "desc" ? "-updated_at" : "updated_at";
}

export function SitePagesPanel({
  siteId,
  pagesEnabled,
  permissions = [],
}: {
  siteId: number;
  pagesEnabled: boolean | null;
  permissions?: readonly string[];
}) {
  return (
    <SitePagesPanelContent
      key={siteId}
      siteId={siteId}
      pagesEnabled={pagesEnabled}
      permissions={permissions}
    />
  );
}

function SitePagesPanelContent({
  siteId,
  pagesEnabled,
  permissions,
}: {
  siteId: number;
  pagesEnabled: boolean | null;
  permissions: readonly string[];
}) {
  const toast = useToast();
  const canView = permissions.includes(PERMISSIONS.view);
  const canCreate = permissions.includes(PERMISSIONS.create);
  const canEdit = permissions.includes(PERMISSIONS.update);
  const canPublish = permissions.includes(PERMISSIONS.publish);
  const [draftFilters, setDraftFilters] = useState<PageFilters>({ search: "", status: "" });
  const [appliedFilters, setAppliedFilters] = useState<PageFilters>({ search: "", status: "" });
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ field: "updated_at", direction: "desc" });
  const [reviewComment, setReviewComment] = useState("");
  const [mode, setMode] = useState<DialogMode | null>(null);
  const [activePage, setActivePage] = useState<SitePageRecord | null>(null);
  const [form, setForm] = useState<PageForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [dialogConflict, setDialogConflict] = useState(false);
  const [showDraftPreview, setShowDraftPreview] = useState(false);
  const [parentPages, setParentPages] = useState<SitePageRecord[]>([]);
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
    setDraftFilters({ search: "", status: "" });
    setAppliedFilters({ search: "", status: "" });
    setPage(1);
  }

  async function openCreate() {
    setActivePage(null);
    setForm({ ...emptyForm(), title: "Admissions", slug: "admissions" });
    setDialogError("");
    setDialogConflict(false);
    setShowDraftPreview(false);
    setMode("create");
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
      setParentPages(results);
    } catch {
      setParentPages(rows);
    }
  }

  async function openEdit(row: SitePageRecord) {
    setSaving(true);
    setDialogError("");
    setDialogConflict(false);
      setShowDraftPreview(false);
    try {
      const current = unwrap(await getSitePage(siteId, row.id));
      setActivePage(current);
      setForm({
        title: current.title, slug: current.slug, parent: current.parent ?? "",
        locale: current.locale || "en", visibility: current.visibility,
        metadata: JSON.stringify(current.metadata ?? {}, null, 2),
        seo: JSON.stringify(current.seo ?? {}, null, 2),
        blocks: (current.blocks ?? []).map((block) => JSON.stringify(block, null, 2)),
      });
      setMode("edit");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "The Page could not be loaded.");
    } finally {
      setSaving(false);
    }
  }

  async function savePage() {
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
          seo: jsonObject(form.seo, "SEO"),
          blocks: blockInputs(form),
        }));
      } else if (mode === "edit" && activePage?.etag) {
        unwrap(await updateSitePage(siteId, activePage.id, activePage.etag, {
          title: form.title.trim(),
          slug: form.slug.trim(),
          parent: form.parent || null,
          visibility: form.visibility,
          metadata: metadataInput(form),
          seo: jsonObject(form.seo, "SEO"),
          blocks: blockInputs(form),
        }));
      } else {
        throw new Error("The Page revision is unavailable. Close and reopen the editor.");
      }
      setMode(null);
      setActivePage(null);
      pages.reload();
      statusCounts.reload();
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
      setForm({
        title: current.title, slug: current.slug, parent: current.parent ?? "",
        locale: current.locale || "en", visibility: current.visibility,
        metadata: JSON.stringify(current.metadata ?? {}, null, 2),
        seo: JSON.stringify(current.seo ?? {}, null, 2),
        blocks: (current.blocks ?? []).map((block) => JSON.stringify(block, null, 2)),
      });
      setDialogConflict(false);
      setDialogError("");
    } catch (cause) {
      setDialogError(cause instanceof Error ? cause.message : "The latest Page could not be loaded.");
    } finally {
      setSaving(false);
    }
  }

  function closeEditor() {
    if (saving) return;
    const dirty = mode === "create"
      ? JSON.stringify(form) !== JSON.stringify({ ...emptyForm(), title: "Admissions", slug: "admissions" })
      : activePage !== null && JSON.stringify(form) !== JSON.stringify({
          title: activePage.title, slug: activePage.slug, parent: activePage.parent ?? "",
          locale: activePage.locale || "en", visibility: activePage.visibility,
          metadata: JSON.stringify(activePage.metadata ?? {}, null, 2),
          seo: JSON.stringify(activePage.seo ?? {}, null, 2),
          blocks: (activePage.blocks ?? []).map((block) => JSON.stringify(block, null, 2)),
        });
    if (!dirty || window.confirm("Discard your unsaved Page changes?")) setMode(null);
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

  async function runPageAction(row: SitePageRecord, action: () => Promise<unknown>) {
    setBusyPageId(row.id);
    try {
      await action();
      pages.reload();
      statusCounts.reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "The Page could not be updated.");
    } finally {
      setBusyPageId(null);
    }
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
      <Button key="preview" size="small" aria-label={`Preview ${row.title}`} onClick={() => {
        setActivePage(row);
        setDialogError("");
        setDialogConflict(false);
        setMode("preview");
      }}>
        Preview
      </Button>,
    ];

    if (canEdit && (row.status === "DRAFT" || row.status === "UNPUBLISHED")) {
      actions.push(
        <Button key="edit" size="small" aria-label={`Edit ${row.title}`} disabled={!enabled} onClick={() => void openEdit(row)}>
          Edit
        </Button>,
      );
    }
    if (row.status === "DRAFT" && canEdit) {
      actions.push(
        <Button
          key="submit"
          size="small"
          aria-label={`Submit ${row.title} for review`}
          disabled={!enabled}
          onClick={() => void runPageAction(row, async () => unwrap(await transitionSitePage(siteId, row.id, "submit")))}
        >
          Submit
        </Button>,
      );
    }
    if (row.status === "IN_REVIEW" && canPublish) {
      actions.push(
        <Button
          key="approve"
          size="small"
          aria-label={`Approve ${row.title}`}
          disabled={!enabled}
          onClick={() => void runPageAction(row, async () => unwrap(await transitionSitePage(siteId, row.id, "approve")))}
        >
          Approve
        </Button>,
        <Button
          key="reject"
          size="small"
          aria-label={`Reject ${row.title}`}
          disabled={!enabled || !reviewComment.trim()}
          onClick={() => void runPageAction(row, async () => unwrap(await transitionSitePage(
            siteId,
            row.id,
            "reject",
            reviewComment.trim(),
          )))}
        >
          Reject
        </Button>,
      );
    }
    if (row.status === "APPROVED" && canPublish) {
      actions.push(
        <Button
          key="publish"
          size="small"
          aria-label={`Publish ${row.title}`}
          disabled={!enabled}
          onClick={() => void runPageAction(row, async () => unwrap(await transitionSitePage(siteId, row.id, "publish")))}
        >
          Publish
        </Button>,
      );
    }
    if (row.status === "PUBLISHED" && canPublish) {
      actions.push(
        <Button
          key="unpublish"
          size="small"
          aria-label={`Unpublish ${row.title}`}
          disabled={!enabled}
          onClick={() => void runPageAction(row, async () => unwrap(await transitionSitePage(siteId, row.id, "unpublish")))}
        >
          Unpublish
        </Button>,
      );
    }
    if (
      canEdit &&
      (row.status === "DRAFT" || row.status === "UNPUBLISHED") &&
      !row.is_homepage
    ) {
      actions.push(
        <Button
          key="homepage"
          size="small"
          aria-label={`Set ${row.title} as homepage`}
          disabled={!enabled}
          onClick={() => void runPageAction(row, async () => unwrap(await setSiteHomepage(siteId, row.id)))}
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
          <Typography variant="h2" component="h2" sx={{ fontSize: "1.25rem", fontWeight: 700 }}>Pages</Typography>
          <Typography variant="body2" color="text.secondary">
            Manage the Pages belonging to this Site.
          </Typography>
        </Box>
        {canCreate ? (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => void openCreate()}
            disabled={!enabled}
          >
            Create page
          </Button>
        ) : null}
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

          {canPublish && rows.some((row) => row.status === "IN_REVIEW") ? (
            <TextField
              label="Review comment"
              value={reviewComment}
              onChange={(event) => setReviewComment(event.target.value)}
              size="small"
              sx={{ maxWidth: 520 }}
            />
          ) : null}

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

      <Dialog
        open={mode === "create" || mode === "edit"}
        onClose={closeEditor}
        fullWidth
        maxWidth="sm"
        aria-labelledby="page-editor-title"
      >
        <DialogTitle id="page-editor-title">
          {mode === "create" ? "Create Page" : "Edit Page"}
        </DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
          {dialogError ? (
            <Alert severity={dialogConflict ? "warning" : "error"} role="alert" action={dialogConflict ? <Button color="inherit" size="small" onClick={() => void reloadLatestAfterConflict()}>Reload latest</Button> : undefined}>
              {dialogError}
            </Alert>
          ) : null}
          {formSyntaxError(form) ? <Alert severity="error" role="alert">{formSyntaxError(form)}</Alert> : null}
          <TextField
            label="Title"
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            disabled={!enabled}
            autoFocus
            required
          />
          <TextField
            label="Slug"
            value={form.slug}
            onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))}
            disabled={!enabled}
            required
            helperText="Use lowercase letters, numbers and hyphens."
          />
          <TextField
            select
            label="Parent Page"
            value={form.parent}
            disabled={!enabled}
            helperText="Only Pages from this Site are available. Route history is preserved when a Page moves."
            onChange={(event) => setForm((current) => ({ ...current, parent: event.target.value }))}
          >
            <MenuItem value="">No parent (top level)</MenuItem>
            {parentPages.filter((row) => row.id !== activePage?.id && !(activePage && row.path.startsWith(`${activePage.path}/`))).map((row) => (
              <MenuItem key={row.id} value={row.id}>{row.title} — {row.path}</MenuItem>
            ))}
          </TextField>
          <TextField label="Locale" value={form.locale} onChange={(event) => setForm((current) => ({ ...current, locale: event.target.value }))} disabled={mode === "edit"} required helperText={mode === "edit" ? "Locale is fixed when the Page is created." : undefined} />
          <TextField select label="Visibility" value={form.visibility} onChange={(event) => setForm((current) => ({ ...current, visibility: event.target.value as SitePageRecord["visibility"] }))}>
            <MenuItem value="PUBLIC">Public</MenuItem><MenuItem value="UNLISTED">Unlisted</MenuItem><MenuItem value="HIDDEN">Hidden</MenuItem>
          </TextField>
          <TextField label="Metadata (JSON object)" value={form.metadata} onChange={(event) => setForm((current) => ({ ...current, metadata: event.target.value }))} multiline minRows={3} helperText="Structured page metadata. Invalid JSON is rejected before save." />
          <TextField label="SEO metadata (JSON object)" value={form.seo} onChange={(event) => setForm((current) => ({ ...current, seo: event.target.value }))} multiline minRows={3} helperText="Page title, description and social preview settings." />
          <Box component="section" aria-label="Content blocks" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <Typography variant="subtitle2">Content blocks</Typography>
            {form.blocks.map((block, index) => (
              <Paper key={`block-${index}`} variant="outlined" sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
                <Typography variant="caption">Block {index + 1} · edit structured JSON</Typography>
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
            ))}
            <Button onClick={() => setForm((current) => ({ ...current, blocks: [...current.blocks, '{"type":"heading","level":2,"text":"New heading"}'] }))}>Add heading block</Button>
            <Button onClick={() => setForm((current) => ({ ...current, blocks: [...current.blocks, '{"type":"paragraph","html":"<p>New paragraph</p>"}'] }))}>Add paragraph block</Button>
            <Button onClick={() => setForm((current) => ({ ...current, blocks: [...current.blocks, JSON.stringify({ type: "image", ref: `sites/${siteId}/image`, alt: "Describe this image" })] }))}>Add image block</Button>
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
                  return <PublicPageView page={{ title: form.title || "Untitled Page", path: activePage?.path ?? `/${form.slug}`, blocks: blockInputs(form) }} />;
                } catch {
                  return <Alert severity="error">Fix block JSON errors to preview this draft.</Alert>;
                }
              })()}
            </Paper>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEditor} disabled={saving}>Cancel</Button>
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
              || (() => { try { jsonObject(form.seo, "SEO"); return false; } catch { return true; } })()
            }
          >
            {saving ? "Saving…" : mode === "create" ? "Create Page" : "Save changes"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={mode === "preview" && activePage !== null}
        onClose={() => setMode(null)}
        fullWidth
        maxWidth="md"
        aria-labelledby="page-preview-title"
      >
        {activePage ? (
          <>
            <DialogTitle id="page-preview-title">Preview: {activePage.title}</DialogTitle>
            <DialogContent dividers>
              <PublicPageView page={previewOf(activePage)} />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setMode(null)}>Close preview</Button>
            </DialogActions>
          </>
        ) : null}
      </Dialog>
    </Paper>
  );
}
