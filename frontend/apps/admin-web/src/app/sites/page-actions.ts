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

export interface SitePageRecord {
  id: string;
  site: number;
  title: string;
  slug: string;
  path: string;
  status: string;
  is_homepage: boolean;
  blocks: Array<Record<string, unknown>>;
  etag: string;
}

interface PageBody extends Omit<SitePageRecord, "etag"> {}

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
  return { ...page, blocks: Array.isArray(page.blocks) ? page.blocks : [], etag: etag ?? "" };
}

export async function loadSitePages(siteId: number): Promise<ActionResult<SitePageRecord[]>> {
  return attempt(async () => {
    const api = await client();
    const listed = await api.get<{ results: PageBody[] }>(
      `${sitePagePath(siteId)}?page_size=20`,
    );
    const pages: SitePageRecord[] = [];
    for (const row of listed.results) {
      if (row.site !== siteId) continue;
      const detail = await api.getDetailed<PageBody>(sitePagePath(siteId, `${row.id}/`));
      pages.push(withEtag(detail.data, detail.etag));
    }
    return pages;
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
  input: { title: string },
): Promise<ActionResult<SitePageRecord>> {
  return attempt(async () => {
    const api = await client();
    const updated = await api.patchDetailed<PageBody>(
      sitePagePath(siteId, `${pageId}/`),
      { title: input.title },
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
