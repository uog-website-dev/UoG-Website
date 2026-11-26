"use client";

/**
 * Site Dashboard: content summaries for the active Site, read from the
 * one scoped aggregate API. A section is summarized only when
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
import {useEffect, useRef, useState, type ReactNode} from "react";
import {RenderProbe} from "@/performance/render-probe";
import {queryKey, useQueryEnvironment, useSiteQuery} from "@/data/query-cache";

import {getSiteDashboardSummary, getSiteDashboardActivity} from "@/data/read-client";
import type {DashboardSummary, DashboardSection} from "@/data/dashboard-contract";
import { unwrap } from "@/organizations/contract";
import { SITE_SECTIONS, sectionByKey, sectionDecision, siteAdminHref } from "@/sites/site-admin";
import type { SiteSection } from "@/sites/site-admin";
import { useSiteAdmin } from "@/sites/site-admin-frame";

interface Metric {
  label: string;
  value: number;
}

type SummarySectionKey = "pages" | "posts" | "menus" | "media" | "users";
const SUMMARIES = {
  pages: {icon: DescriptionIcon, title: "Pages", empty: "This Site has no Pages yet."},
  posts: {icon: ArticleIcon, title: "Posts", empty: "This Site has no Posts yet."},
  menus: {icon: AccountTreeIcon, title: "Menus", empty: "This Site has no local menus yet."},
  media: {icon: PhotoLibraryIcon, title: "Media", empty: "This Site has no media yet."},
  users: {icon: GroupIcon, title: "Users", empty: "No active members are assigned to this Site yet."},
};
interface SummaryState {
  status: "idle" | "loading" | "success" | "error";
  data: Metric[] | null; error: Error | null; loading: boolean; refreshing: boolean; reload: () => void;
}
function metrics(kind: SummarySectionKey, section: DashboardSection | undefined): Metric[] | null {
  if (section?.status !== "ready" || !section.counts) return null;
  const count = section.counts;
  if (kind === "pages" || kind === "posts") return [{label:"Total",value:count.total!},{label:"Draft",value:count.DRAFT!},{label:"In review",value:count.IN_REVIEW!},{label:"Published",value:count.PUBLISHED!}];
  if (kind === "menus") return [{label:"Local menus",value:count.total!},{label:"Active",value:count.active!},{label:"Menu items",value:count.items!}];
  return [{label:kind === "media" ? "Assets" : "Active members",value:count.total!}];
}
function Freshness({data}: {data: DashboardSummary}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer);}, []);
  return <Typography variant="caption" color="text.secondary">
    <time dateTime={data.generated_at}>Updated {new Date(data.generated_at).toLocaleTimeString()}</time>
    {data.cache.hit ? " | Cached snapshot" : " | Snapshot"}{!data.cache.available ? " | Cache unavailable" : ""}
    {now >= Date.parse(data.expires_at) ? " | Refresh due" : ""}
  </Typography>;
}
function RecentActivity({siteId, allowed}: {siteId: number; allowed: string[]}) {
  const activity = useSiteQuery(siteId, "dashboard-activity", {allowed}, async (signal) => unwrap(await getSiteDashboardActivity(siteId, signal)), {staleTime:15_000, refetchInterval:30_000, scopeProtected:true});
  return <Paper component="section" data-dashboard-secondary-pending={activity.loading || activity.refreshing ? "true" : "false"} aria-labelledby="dashboard-recent" variant="outlined" sx={{p:2.5,borderRadius:3}}>
    <Typography id="dashboard-recent" variant="h6" component="h2">Recent content activity</Typography>
    {activity.error ? <Alert severity="warning" action={<Button onClick={activity.reload}>Retry activity</Button>}>Recent activity is unavailable. Summary counts remain available.</Alert>
      : activity.data ? activity.data.results.filter(row => allowed.includes(row.kind)).length ? <Box component="ul">{activity.data.results.filter(row => allowed.includes(row.kind)).map(row => <li key={row.id}>{row.title} | {row.kind === "pages" ? "Page" : "Post"} | {row.status.replaceAll("_", " ")}</li>)}</Box> : <Typography>No recent content activity.</Typography>
      : <Typography role="status">Loading recent activity...</Typography>}
  </Paper>;
}
function SummaryCardView({sectionKey, siteId, state}: {sectionKey: SummarySectionKey; siteId: number; state: SummaryState}) {
  const summary = SUMMARIES[sectionKey];
  const Icon = summary.icon;
  const headingId = `site-summary-${sectionKey}`;
  const empty = state.data != null && (state.data[0]?.value ?? 0) === 0;

  let body: ReactNode;
  if (state.status === "error" && !state.data) {
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
      data-perf-pending={state.loading || !state.data ? "true" : "false"}
      data-perf-error={state.error ? "true" : "false"}
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
      {state.refreshing ? <Typography role="status" variant="caption">Refreshing {summary.title.toLowerCase()}...</Typography> : null}
      {state.error && state.data ? <Alert severity="warning" action={<Button onClick={state.reload}>Retry summary</Button>}>Refresh failed. Previously loaded totals are shown.</Alert> : null}
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
  return <RenderProbe id="dashboard"><DashboardContent/></RenderProbe>;
}
function DashboardContent() {
  const admin = useSiteAdmin();
  const siteId = admin.site.id;
  const environment = useQueryEnvironment();
  const summary = useSiteQuery(siteId, "dashboard-summary", {}, async (signal) => unwrap(await getSiteDashboardSummary(siteId, signal)), {staleTime:15_000, refetchInterval:15_000, scopeProtected:true});
  // Warm the existing Page-counts contract without a second six-list read.
  useEffect(() => {
    const section = summary.data?.sections.pages;
    if (section?.status !== "ready" || !section.counts || !admin.enabledModuleCodes.includes("PAGES") || !admin.permissions.includes("content.pages.view")) return;
    const {total: _, ...counts} = section.counts;
    let current = true;
    const key = queryKey({...environment,siteId}, "page-counts");
    const generated = Date.parse(summary.data!.generated_at);
    void environment.client.cancelQueries({queryKey:key, exact:true}).then(() => {
      if (current) environment.client.setQueryData(key, counts, {updatedAt:generated});
    });
    return () => {current = false;};
  }, [summary.data, environment.client, environment.identity, environment.authorization, siteId]);
  const contentSections = SITE_SECTIONS.filter(
    (section): section is SiteSection & { key: SummarySectionKey } =>
      section.key !== "dashboard" && section.key !== "builder" && section.key !== "homepage" && section.key !== "sidebars",
  );
  const countPermissions: Record<SummarySectionKey,string> = {pages:"content.pages.view",posts:"content.posts.view",menus:"menu.read",media:"content.media.view",users:"platform.users.view"};
  const accessible = contentSections.filter((section) => sectionDecision(section, admin) === "visible");
  const visible = accessible.filter(section => admin.permissions.includes(countPermissions[section.key]));
  const scopeMismatch = useRef<string | null>(null);
  const missing = summary.data ? visible.filter(section => !(section.key in summary.data!.sections)).map(section => section.key).sort().join(",") : "";
  useEffect(() => {
    if (!missing) {scopeMismatch.current = null; return;}
    const signature = `${siteId}:${environment.authorization}:${missing}`;
    if (scopeMismatch.current === signature) return;
    scopeMismatch.current = signature;
    // A live response can reveal a module/read grant removal before the next
    // workspace lease refresh. Do not allow other cached views to restore it.
    const obsolete = {predicate: (query: {queryKey: readonly unknown[]}) => query.queryKey[1] === environment.identity && query.queryKey[2] === siteId && !["workspace", "dashboard-summary"].includes(String(query.queryKey[4]))};
    void environment.client.cancelQueries(obsolete);
    environment.client.removeQueries(obsolete);
    window.dispatchEvent(new Event("uog:workspace:refresh"));
  }, [missing, siteId, environment.client, environment.identity, environment.authorization]);
  const disabled = contentSections.filter(
    (section) =>
      sectionDecision(section, admin) === "module_disabled" &&
      section.permissions.some((code) => admin.permissions.includes(code)),
  );
  const canCreatePage = accessible.some((section) => section.key === "pages") &&
    admin.permissions.includes("content.pages.create");
  const canManageMenus = accessible.some((section) => section.key === "menus");
  const canManageHomepage = sectionDecision(sectionByKey("homepage"), admin) === "visible";
  const canOpenBuilder = sectionDecision(sectionByKey("builder"), admin) === "visible";

  return (
    <Box data-perf-section="dashboard" data-dashboard-summary-refreshing={summary.refreshing ? "true" : "false"} sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {/* The frame banner used to own the page heading; the dashboard keeps
          its own H1 so the section still has one top-level title. */}
      <Typography component="h1" variant="h4" sx={{ fontWeight: 700 }}>
        Dashboard
      </Typography>
      {canCreatePage || canManageMenus || canManageHomepage || canOpenBuilder ? (
        <Box component="section" aria-labelledby="site-quick-actions" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Typography id="site-quick-actions" variant="h6" component="h2" sx={{ fontWeight: 700 }}>
            Quick actions
          </Typography>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            {canCreatePage ? (
              <Button
                component={Link}
                href={`${siteAdminHref(siteId, "pages")}/new`}
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
        {summary.data ? <Freshness data={summary.data}/> : null}
        {visible.length === 0 ? (
          <Alert severity="info" variant="outlined" role="status">
            No content modules are available to you for this Site.
          </Alert>
        ) : (
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(3, minmax(0, 1fr))" } }}>
            {visible.map((section) => (
              <SummaryCardView key={section.key} sectionKey={section.key} siteId={siteId} state={{
                ...summary, data: metrics(section.key, summary.data?.sections[section.key]),
                status: summary.data && summary.data.sections[section.key]?.status !== "ready" ? "error" : summary.status,
                loading: summary.loading,
                error: summary.error ?? (summary.data && summary.data.sections[section.key]?.status !== "ready" ? new Error("Counts are not available for this section. Retry later.") : null),
              }} />
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
      {summary.data && (summary.data.sections.pages || summary.data.sections.posts) ? <RecentActivity siteId={siteId} allowed={["pages", "posts"].filter(key => key in summary.data!.sections)}/> : null}
    </Box>
  );
}
