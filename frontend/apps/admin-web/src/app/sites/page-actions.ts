"use server";

/**
 * Site-scoped Page authoring.
 *
 * Every path is built from the Site id argument. These actions do not accept
 * a second Site. The Keycloak token stays on the server.
 */
import { createApiClient } from "@uog/api-client";
import type { LayoutSection, VisualLayout } from "@uog/types";

import { getAccessToken } from "@/access-token";
import { serializeApiError } from "@/organizations/contract";
import type { ActionResult } from "@/organizations/contract";
import { sitePagePath } from "@/sites/page-paths";

export type SitePageStatus =
  | "DRAFT"
  | "IN_REVIEW"
  | "APPROVED"
  | "PUBLISHED"
  | "UNPUBLISHED"
  | "ARCHIVED";

export interface SitePageMediaItem {
  id: string;
  asset_id: string;
  alt: string;
  caption?: string;
}

export interface SitePageBlock {
  type: string;
  id?: string;
  text?: string;
  html?: string;
  level?: number;
  label?: string;
  href?: string;
  alt?: string;
  ref?: string;
  items?: string[];
  style?: string;
  heading?: string;
  slides?: SitePageMediaItem[];
  images?: SitePageMediaItem[];
  children?: SitePageBlock[];
}
export interface SitePageRecord {
  id: string;
  site: number;
  parent: string | null;
  title: string;
  slug: string;
  path: string;
  status: SitePageStatus;
  visibility: "PUBLIC" | "UNLISTED" | "HIDDEN";
  locale: string;
  is_homepage: boolean;
  can_set_homepage?: boolean;
  created_by: number | string | null;
  submitted_by?: number | string | null;
  reviewed_by?: number | string | null;
  review_comment?: string;
  updated_at: string;
  blocks: SitePageBlock[];
  metadata?: Record<string, unknown>;
  seo?: Record<string, unknown>;
  sidebar?: string | null;
  sidebar_snapshot?: import("@uog/ui").SidebarSnapshot;
  layout?: string;
  position?: number;
  draft_of?: string | null;
  etag?: string;
  revision_number?: number;
  available_actions?: SitePageWorkflowAction[];
}

export type SitePageWorkflowAction =
  | "submit" | "approve" | "reject" | "publish" | "unpublish"
  | "archive" | "restore" | "revise";

export interface SitePageWorkflowTransition {
  id: number;
  from_status: SitePageStatus;
  to_status: SitePageStatus;
  actor: number | null;
  comment: string;
  created_at: string;
}

export interface SitePageListQuery {
  search?: string;
  status?: SitePageStatus;
  page?: number;
  page_size?: number;
  ordering?: "title" | "-title" | "updated_at" | "-updated_at";
}

export interface SitePageListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: SitePageRecord[];
}

type PageBody = Omit<SitePageRecord, "etag">;

const PAGE_STATUSES: readonly SitePageStatus[] = [
  "DRAFT",
  "IN_REVIEW",
  "APPROVED",
  "PUBLISHED",
  "UNPUBLISHED",
  "ARCHIVED",
];

function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://backend:8000/api";
}

async function client() {
  const accessToken = await getAccessToken();
  return createApiClient({
    baseUrl: apiBaseUrl(),
    accessToken: accessToken ?? undefined,
  });
}

async function attempt<T>(run: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (cause) {
    return { ok: false, error: serializeApiError(cause) };
  }
}

function withEtag(page: PageBody, etag: string | null): SitePageRecord {
  return {
    ...page,
    blocks: Array.isArray(page.blocks) ? page.blocks : [],
    etag: etag ?? "",
  };
}

function queryString(query: SitePageListQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

export async function loadSitePages(
  siteId: number,
  query: SitePageListQuery = {},
): Promise<ActionResult<SitePageListResponse>> {
  return attempt(async () => {
    const api = await client();
    const listed = await api.get<SitePageListResponse>(
      `${sitePagePath(siteId)}${queryString(query)}`,
    );
    return {
      ...listed,
      results: listed.results.filter((page) => page.site === siteId),
    };
  });
}

export async function loadSitePageStatusCounts(
  siteId: number,
): Promise<ActionResult<Record<SitePageStatus, number>>> {
  return attempt(async () => {
    const api = await client();
    const counts = await Promise.all(
      PAGE_STATUSES.map(async (status) => {
        const result = await api.get<SitePageListResponse>(
          `${sitePagePath(siteId)}${queryString({ status, page: 1, page_size: 1 })}`,
        );
        return [status, result.count] as const;
      }),
    );
    return Object.fromEntries(counts) as Record<SitePageStatus, number>;
  });
}

export async function getSitePage(
  siteId: number,
  pageId: string,
): Promise<ActionResult<SitePageRecord>> {
  return attempt(async () => {
    const api = await client();
    const result = await api.getDetailed<PageBody>(
      sitePagePath(siteId, `${pageId}/`),
    );
    if (result.data.site !== siteId) {
      throw new Error("The Page does not belong to this Site.");
    }
    return withEtag(result.data, result.etag);
  });
}

export async function getSiteVisualDraft(siteId: number, pageId: string): Promise<ActionResult<SitePageRecord>> {
  return attempt(async () => {
    const api = await client();
    const result = await api.getDetailed<PageBody>(sitePagePath(siteId, `${pageId}/visual-draft/`));
    if (result.data.site !== siteId) throw new Error("The Page does not belong to this Site.");
    return withEtag(result.data, result.etag);
  });
}

/** Complete replacement with the caller's last loaded ETag. Never retries a conflict. */
export async function saveSiteVisualDraft(siteId: number, pageId: string, ifMatch: string, visualLayout: VisualLayout): Promise<ActionResult<SitePageRecord>> {
  return attempt(async () => {
    const api = await client();
    const result = await api.patchDetailed<PageBody>(sitePagePath(siteId, `${pageId}/visual-draft/`), {visual_layout:visualLayout}, {ifMatch});
    if (result.data.site !== siteId) throw new Error("The Page does not belong to this Site.");
    return withEtag(result.data, result.etag);
  });
}

export interface SiteSectionTemplate {
  id: string;
  site: number;
  name: string;
  status: "ACTIVE" | "RETIRED";
  schema_version: number;
  version: number;
  section: LayoutSection;
  created_at: string;
  updated_at: string;
}

function siteSectionTemplatePath(siteId: number, suffix = ""): string {
  if (!Number.isInteger(siteId) || siteId < 1) throw new Error("A template request needs one Site id.");
  const tail = suffix.replace(/^\/+/, "");
  return tail ? `/v1/sites/${siteId}/section-templates/${tail}` : `/v1/sites/${siteId}/section-templates/`;
}

export async function listSiteSectionTemplates(siteId: number): Promise<ActionResult<SiteSectionTemplate[]>> {
  return attempt(async () => {
    const api = await client();
    const rows = await api.get<SiteSectionTemplate[]>(siteSectionTemplatePath(siteId));
    return rows.filter((row) => row.site === siteId);
  });
}

export async function createSiteSectionTemplate(
  siteId: number,
  name: string,
  section: LayoutSection,
): Promise<ActionResult<SiteSectionTemplate>> {
  return attempt(async () => {
    const api = await client();
    const created = await api.post<SiteSectionTemplate>(siteSectionTemplatePath(siteId), { name, section });
    if (created.site !== siteId) throw new Error("The template does not belong to this Site.");
    return created;
  });
}

/** Server-side clone with fresh IDs and media revalidation. Never retries a conflict. */
export async function insertSiteSectionTemplate(
  siteId: number,
  pageId: string,
  ifMatch: string,
  templateId: string,
): Promise<ActionResult<SitePageRecord>> {
  return attempt(async () => {
    const api = await client();
    const result = await api.postDetailed<PageBody>(
      sitePagePath(siteId, `${pageId}/visual-draft/insert-template/`),
      { template_id: templateId },
      { headers: { "If-Match": ifMatch } },
    );
    if (result.data.site !== siteId) throw new Error("The Page does not belong to this Site.");
    return withEtag(result.data, result.etag);
  });
}

export async function createSitePage(
  siteId: number,
  input: {
    title: string; slug: string; parent: string | null;
    locale: string; visibility: SitePageRecord["visibility"]; layout?: string; sidebar?: string | null;
    metadata: Record<string, unknown>; seo: Record<string, unknown>; blocks: SitePageBlock[];
  },
): Promise<ActionResult<SitePageRecord>> {
  return attempt(async () => {
    const api = await client();
    const created = await api.postDetailed<PageBody>(sitePagePath(siteId), {
      title: input.title,
      slug: input.slug,
      parent: input.parent,
      locale: input.locale,
      visibility: input.visibility,
      layout: input.layout ?? "FULL_WIDTH",
      ...(input.sidebar !== undefined ? { sidebar: input.sidebar } : {}),
      metadata: input.metadata,
      seo: input.seo,
      blocks: input.blocks,
    });
    return withEtag(created.data, created.etag);
  });
}

export async function openWorkingDraft(
  siteId: number,
  pageId: string,
  ifMatch: string,
): Promise<ActionResult<SitePageRecord>> {
  return attempt(async () => {
    const api = await client();
    const opened = await api.postDetailed<PageBody>(
      sitePagePath(siteId, `${pageId}/working-draft/`),
      {},
      { headers: { "If-Match": ifMatch } },
    );
    if (opened.data.site !== siteId) {
      throw new Error("The Page does not belong to this Site.");
    }
    return withEtag(opened.data, opened.etag);
  });
}

export async function updateSitePage(
  siteId: number,
  pageId: string,
  ifMatch: string,
  input: {
    title?: string; slug?: string; parent?: string | null; visibility?: SitePageRecord["visibility"]; layout?: string; sidebar?: string | null;
    metadata?: Record<string, unknown>; seo?: Record<string, unknown>; blocks?: SitePageBlock[];
  },
): Promise<ActionResult<SitePageRecord>> {
  return attempt(async () => {
    const api = await client();
    const updated = await api.patchDetailed<PageBody>(
      sitePagePath(siteId, `${pageId}/`),
      input,
      { ifMatch },
    );
    return withEtag(updated.data, updated.etag);
  });
}

export async function transitionSitePage(
  siteId: number,
  pageId: string,
  action: SitePageWorkflowAction,
  comment = "",
  ifMatch?: string,
): Promise<ActionResult<SitePageRecord>> {
  return attempt(async () => {
    const api = await client();
    const result = await api.postDetailed<PageBody>(
      sitePagePath(siteId, `${pageId}/workflow/`),
      { action, comment },
      ifMatch ? {headers:{"If-Match":ifMatch}} : undefined,
    );
    return withEtag(result.data, result.etag);
  });
}

export interface SitePagePreview {
  revision_id:number;revision_number:number;content_hash:string;status:SitePageStatus;
  approval_id:number|null;reviewed_revision_id:number|null;approved_revision_id:number|null;
  page:{title:string;path:string;site:number;layout?:string;locale?:string;blocks:SitePageBlock[];metadata:Record<string,unknown>;seo:Record<string,unknown>};
  etag:string;
}

export async function getSitePagePreview(siteId:number,pageId:string,revision?:number):Promise<ActionResult<SitePagePreview>> {
  return attempt(async()=>{
    const api=await client();
    const result=await api.getDetailed<Omit<SitePagePreview,"etag">>(sitePagePath(siteId,`${pageId}/preview/${revision ? `?revision=${revision}`:""}`));
    if(result.data.page.site !== siteId)throw new Error("The preview does not belong to this Site.");
    return {...result.data,etag:result.etag ?? ""};
  });
}

export async function loadSitePageWorkflowHistory(
  siteId: number,
  pageId: string,
): Promise<ActionResult<SitePageWorkflowTransition[]>> {
  return attempt(async () => {
    const api = await client();
    return api.get<SitePageWorkflowTransition[]>(
      sitePagePath(siteId, `${pageId}/workflow-history/`),
    );
  });
}

export async function setSiteHomepage(
  siteId: number,
  pageId: string,
): Promise<ActionResult<SitePageRecord>> {
  return attempt(async () => {
    const api = await client();
    const result = await api.postDetailed<PageBody>(
      sitePagePath(siteId, `${pageId}/homepage/`),
      {},
    );
    return withEtag(result.data, result.etag);
  });
}
