"use client";
import {useEffect, useRef} from "react";
import {useRouter} from "next/navigation";
import type {QueryClient} from "@tanstack/react-query";
import {loadSitePageStatusCounts} from "@/app/sites/page-actions";
import {unwrap} from "@/organizations/contract";
import {findSiteSection, sectionDecision, siteAdminHref} from "@/sites/site-admin";
import type {WorkspacePayload} from "@/workspace";
import {GC_MS, STALE_MS, queryKey, useQueryEnvironment} from "./query-cache";

export const PREFETCH_DWELL_MS = 180;
export const PREFETCH_THROTTLE_MS = 1_000;
const CONTENT = new Set(["pages", "posts", "menus", "media"]);
type Plan = {timer?: ReturnType<typeof setTimeout>; owner?: object; last: number; routes: Map<string, number>};
const plans = new WeakMap<QueryClient, Plan>();

/** Explicit intent only. Route code plus approved aggregate counts, never speculative content lists. */
export function useSectionPrefetch(siteId: number) {
  const environment = useQueryEnvironment();
  const router = useRouter();
  const owner = useRef({}).current;
  let plan = plans.get(environment.client);
  if (!plan) {plan = {last: -Infinity, routes: new Map()}; plans.set(environment.client, plan);}
  const current = plan;
  const cancel = () => {if (current.owner === owner) {clearTimeout(current.timer); current.timer = undefined; current.owner = undefined;}};
  useEffect(() => cancel, [environment.client, environment.identity, environment.authorization, siteId]);
  const schedule = (sectionKey: string) => {
    if (!CONTENT.has(sectionKey)) return;
    clearTimeout(current.timer); current.owner = owner;
    current.timer = setTimeout(() => {
      current.timer = undefined;
      const connection = (navigator as Navigator & {connection?: {saveData?: boolean; effectiveType?: string}}).connection;
      if (document.visibilityState === "hidden" || navigator.onLine === false || connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType ?? "")) return;
      const workspace = environment.client.getQueryState<WorkspacePayload>(queryKey({...environment, siteId, authorization: "bootstrap"}, "workspace", {site: siteId}));
      const site = workspace?.data?.site;
      const section = findSiteSection(sectionKey);
      if (!workspace || workspace.isInvalidated || workspace.error || Date.now() - workspace.dataUpdatedAt >= STALE_MS || site?.id !== siteId || !section || sectionDecision(section, site) !== "visible") return;
      const href = siteAdminHref(siteId, section.segment), now = Date.now();
      const routeKey = `${environment.identity}:${siteId}:${environment.authorization}:${href}`;
      if (now - current.last < PREFETCH_THROTTLE_MS || now - (current.routes.get(routeKey) ?? -Infinity) < STALE_MS) return;
      current.last = now; current.routes.set(routeKey, now);
      // Bound bookkeeping independently of the number of visited Sites.
      for (const [key, at] of current.routes) if (now - at >= STALE_MS) current.routes.delete(key);
      try {void Promise.resolve(router.prefetch(href)).catch(() => undefined);} catch { /* intent is optional */ }
      if (sectionKey === "pages" && site.permissions.includes("content.pages.view") && environment.client.getQueryState(queryKey({...environment, siteId}, "dashboard-summary"))?.fetchStatus !== "fetching") {
        void environment.client.prefetchQuery({queryKey: queryKey({...environment, siteId}, "page-counts"), staleTime: STALE_MS, gcTime: GC_MS, meta: {scopeProtected: true},
          queryFn: async ({signal}) => {const counts = unwrap(await loadSitePageStatusCounts(siteId)); signal.throwIfAborted(); return counts;},
        });
      }
    }, PREFETCH_DWELL_MS);
  };
  return {schedule, cancel};
}
