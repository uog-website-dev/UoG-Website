"use server";

/**
 * Site-scoped Page authoring.
 *
 * Every path is built from the Site id argument. These actions do not accept
 * a second Site. The Keycloak token stays on the server.
 */
import { createApiClient } from "@uog/api-client";

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

export interface SitePageBlock {
  type: string;
  text?: string;
  html?: string;
  level?: number;
  label?: string;
  href?: string;
  alt?: string;
  items?: string[];
  style?: string;
  heading?: string;
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
  created_by: number | string | null;
  updated_at: string;
  blocks: SitePageBlock[];
  etag?: string;
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

export async function createSitePage(
  siteId: number,
  input: { title: string; slug: string; text: string },
): Promise<ActionResult<SitePageRecord>> {
  return attempt(async () => {
    const api = await client();
    const created = await api.postDetailed<PageBody>(sitePagePath(siteId), {
      title: input.title,
      slug: input.slug,
      blocks: [{ type: "paragraph", html: `<p>${escapeHtml(input.text)}</p>` }],
    });
    return withEtag(created.data, created.etag);
  });
}

export async function updateSitePage(
  siteId: number,
  pageId: string,
  ifMatch: string,
  input: { title: string; slug: string },
): Promise<ActionResult<SitePageRecord>> {
  return attempt(async () => {
    const api = await client();
    const updated = await api.patchDetailed<PageBody>(
      sitePagePath(siteId, `${pageId}/`),
      { title: input.title, slug: input.slug },
      { ifMatch },
    );
    return withEtag(updated.data, updated.etag);
  });
}

export async function transitionSitePage(
  siteId: number,
  pageId: string,
  action: "submit" | "approve" | "reject" | "publish" | "unpublish",
  comment = "",
): Promise<ActionResult<SitePageRecord>> {
  return attempt(async () => {
    const api = await client();
    const result = await api.postDetailed<PageBody>(
      sitePagePath(siteId, `${pageId}/workflow/`),
      { action, comment },
    );
    return withEtag(result.data, result.etag);
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "\"": return "&quot;";
      default: return "&#39;";
    }
  });
}
