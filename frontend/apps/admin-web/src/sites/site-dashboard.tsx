"use client";

/**
 * Site Dashboard: content summaries for the active Site, read from the
 * Site-scoped Page, Post and Menu APIs. A section is summarized only when
 * the Site has its module enabled and this account may open it; Django
 * still filters every count by Site scope.
 */
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import AddIcon from "@mui/icons-material/Add";
import ArticleIcon from "@mui/icons-material/Article";
import DescriptionIcon from "@mui/icons-material/Description";
import GroupIcon from "@mui/icons-material/Group";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import ViewQuiltIcon from "@mui/icons-material/ViewQuilt";
import type { SvgIconComponent } from "@mui/icons-material";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import type { ReactNode } from "react";
import { useAsync } from "@uog/ui";

import { loadSiteNavigation } from "@/app/sites/menu-actions";
import { loadSitePageStatusCounts } from "@/app/sites/page-actions";
import { loadSitePosts } from "@/app/sites/post-actions";
import { listSiteMedia } from "@/app/sites/media-actions";
import { getSiteUsers } from "@/app/sites/user-actions";
import type { SitePostStatus } from "@/app/sites/post-actions";
import { unwrap } from "@/organizations/contract";
import { SITE_SECTIONS, sectionByKey, sectionDecision, siteAdminHref } from "@/sites/site-admin";
import type { SiteSection } from "@/sites/site-admin";
import { useSiteAdmin } from "@/sites/site-admin-frame";

interface Metric {
  label: string;
  value: number;
}

const POST_SUMMARY_STATUSES: readonly SitePostStatus[] = ["DRAFT", "IN_REVIEW", "PUBLISHED"];

async function pageSummary(siteId: number): Promise<Metric[]> {
  const counts = unwrap(await loadSitePageStatusCounts(siteId));
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return [
    { label: "Total", value: total },
    { label: "Draft", value: counts.DRAFT },
    { label: "In review", value: counts.IN_REVIEW },
    { label: "Published", value: counts.PUBLISHED },
  ];
}

async function postSummary(siteId: number): Promise<Metric[]> {
  const [total, ...byStatus] = await Promise.all([
    loadSitePosts(siteId, { page: 1, page_size: 1 }),
    ...POST_SUMMARY_STATUSES.map((status) => loadSitePosts(siteId, { status, page: 1, page_size: 1 })),
  ]);
  return [
    { label: "Total", value: unwrap(total!).count },
    { label: "Draft", value: unwrap(byStatus[0]!).count },
    { label: "In review", value: unwrap(byStatus[1]!).count },
    { label: "Published", value: unwrap(byStatus[2]!).count },
  ];
}

async function menuSummary(siteId: number): Promise<Metric[]> {
  const navigation = unwrap(await loadSiteNavigation(siteId));
  const local = navigation.menus.filter((row) => !row.menu.is_global && row.menu.site === siteId);
  return [
    { label: "Local menus", value: local.length },
    { label: "Active", value: local.filter((row) => row.menu.is_active).length },
    { label: "Menu items", value: local.reduce((sum, row) => sum + row.items.length, 0) },
  ];
}

async function userSummary(siteId: number): Promise<Metric[]> {
  const directory = await getSiteUsers(siteId, "", 1);
  return [{ label: "Assigned users", value: directory.count }];
}

type SummarySectionKey = Exclude<SiteSection["key"], "dashboard" | "builder" | "homepage">;

const SUMMARIES: Record<SummarySectionKey, {
  icon: SvgIconComponent;
  title: string;
  empty: string;
  load: (siteId: number) => Promise<Metric[]>;
}> = {
  pages: { icon: DescriptionIcon, title: "Pages", empty: "This Site has no Pages yet.", load: pageSummary },
  posts: { icon: ArticleIcon, title: "Posts", empty: "This Site has no Posts yet.", load: postSummary },
  menus: { icon: AccountTreeIcon, title: "Menus", empty: "This Site has no local menus yet.", load: menuSummary },
  media: { icon: PhotoLibraryIcon, title: "Media", empty: "This Site has no media yet.", load: async (siteId) => [{ label: "Assets", value: unwrap(await listSiteMedia(siteId)).count }] },
  users: { icon: GroupIcon, title: "Users", empty: "No users are assigned to this Site yet.", load: userSummary },
};

function SummaryCard({
  sectionKey,
  siteId,
}: {
  sectionKey: SummarySectionKey;
  siteId: number;
}) {
  const summary = SUMMARIES[sectionKey];
  const state = useAsync(() => summary.load(siteId), [siteId, sectionKey]);
  const Icon = summary.icon;
  const headingId = `site-summary-${sectionKey}`;
  const empty = state.data != null && (state.data[0]?.value ?? 0) === 0;

  let body: ReactNode;
  if (state.status === "error") {
    body = (
      <Alert
        severity="error"
        variant="outlined"
        action={<Button color="inherit" size="small" onClick={state.reload}>Try again</Button>}
      >
        {summary.title} could not be summarized: {state.error?.message ?? "the request failed"}.
      </Alert>
    );
  } else if (state.data == null) {
    body = (
      <Box role="status" aria-label={`Loading ${summary.title}`}>
        <Skeleton variant="text" width="60%" />
        <Skeleton variant="text" width="80%" />
      </Box>
    );
  } else {
    body = (
      <>
        <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1.5 }}>
          {state.data.map((metric) => (
            <Box key={metric.label}>
              <Typography component="dt" variant="caption" color="text.secondary">{metric.label}</Typography>
              <Typography component="dd" variant="h5" sx={{ m: 0, fontWeight: 700 }}>{metric.value}</Typography>
            </Box>
          ))}
        </Box>
        {empty ? <Typography variant="body2" color="text.secondary">{summary.empty}</Typography> : null}
      </>
    );
  }

  return (
    <Paper
      component="section"
      aria-labelledby={headingId}
      variant="outlined"
      sx={{ p: 2.5, borderRadius: 3, display: "flex", flexDirection: "column", gap: 1.5 }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
        <Box
          aria-hidden="true"
          sx={{
            display: "grid",
            placeItems: "center",
            width: 36,
            height: 36,
            borderRadius: 2,
            bgcolor: "primary.main",
            color: "primary.contrastText",
          }}
        >
          <Icon fontSize="small" />
        </Box>
        <Typography id={headingId} variant="h6" component="h3" sx={{ fontWeight: 700 }}>
          {summary.title}
        </Typography>
      </Box>
      {body}
      <Box sx={{ mt: "auto" }}>
        <Button component={Link} href={siteAdminHref(siteId, sectionKey)} size="small">
          Open {summary.title.toLowerCase()}
        </Button>
      </Box>
    </Paper>
  );
}

export function SiteDashboard() {
  const admin = useSiteAdmin();
  const siteId = admin.site.id;
  const contentSections = SITE_SECTIONS.filter(
    (section): section is SiteSection & { key: SummarySectionKey } =>
      section.key !== "dashboard" && section.key !== "builder" && section.key !== "homepage",
  );
  const visible = contentSections.filter((section) => sectionDecision(section, admin) === "visible");
  const disabled = contentSections.filter(
    (section) =>
      sectionDecision(section, admin) === "module_disabled" &&
      section.permissions.some((code) => admin.permissions.includes(code)),
  );
  const canCreatePage = visible.some((section) => section.key === "pages") &&
    admin.permissions.includes("content.pages.create");
  const canManageMenus = visible.some((section) => section.key === "menus");
  const canManageHomepage = sectionDecision(sectionByKey("homepage"), admin) === "visible";
  const canOpenBuilder = sectionDecision(sectionByKey("builder"), admin) === "visible";

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {canCreatePage || canManageMenus || canManageHomepage || canOpenBuilder ? (
        <Box component="section" aria-labelledby="site-quick-actions" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Typography id="site-quick-actions" variant="h6" component="h2" sx={{ fontWeight: 700 }}>
            Quick actions
          </Typography>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            {canCreatePage ? (
              <Button
                component={Link}
                href={`${siteAdminHref(siteId, "pages")}?create=1`}
                variant="contained"
                startIcon={<AddIcon />}
              >
                Create page
              </Button>
            ) : null}
            {canOpenBuilder ? (
              <Button component={Link} href={siteAdminHref(siteId, "builder")} variant="outlined" startIcon={<ViewQuiltIcon />}>
                Visual Builder
              </Button>
            ) : null}
            {canManageHomepage ? (
              <Button component={Link} href={siteAdminHref(siteId, "homepage")} variant="outlined" startIcon={<HomeOutlinedIcon />}>
                Homepage Settings
              </Button>
            ) : null}
            {canManageMenus ? (
              <Button component={Link} href={siteAdminHref(siteId, "menus")} variant="outlined" startIcon={<AccountTreeIcon />}>
                Manage navigation
              </Button>
            ) : null}
          </Box>
        </Box>
      ) : null}

      <Box component="section" aria-labelledby="site-content-summary" sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Typography id="site-content-summary" variant="h6" component="h2" sx={{ fontWeight: 700 }}>
          Content summary
        </Typography>
        {visible.length === 0 ? (
          <Alert severity="info" variant="outlined" role="status">
            No content modules are available to you for this Site.
          </Alert>
        ) : (
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(3, minmax(0, 1fr))" } }}>
            {visible.map((section) => (
              <SummaryCard key={section.key} sectionKey={section.key} siteId={siteId} />
            ))}
          </Box>
        )}
        {disabled.length > 0 ? (
          <Typography variant="body2" color="text.secondary">
            Not enabled for this Site: {disabled.map((section) => section.label).join(", ")}.
            Module activation is managed in platform administration.
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}
