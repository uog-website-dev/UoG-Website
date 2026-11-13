"use server";

/** Site-scoped Post and taxonomy actions. The access token remains server-side. */
import { createApiClient } from "@uog/api-client";

import { getAccessToken } from "@/access-token";
import { serializeApiError } from "@/organizations/contract";
import type { ActionResult } from "@/organizations/contract";
import { siteCategoriesPath, sitePostWorkflowHistoryPath, sitePostWorkflowPath, sitePostsPath, siteTagsPath } from "@/sites/post-paths";
import type { ArticleDocument } from "@uog/ui";

export type SitePostStatus =
  | "DRAFT" | "IN_REVIEW" | "APPROVED" | "PUBLISHED" | "UNPUBLISHED" | "ARCHIVED";

export interface SitePostRecord {
  id: string;
  site: number;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  editor_document?: ArticleDocument | null;
  blocks: SitePostBlock[];
  seo: Record<string, unknown>;
  featured_media: string;
  featured_alt?: string;
  revision_number?: number;
  draft_of?: string | null;
  publication_slug?: string;
  publication_status?: SitePostStatus;
  review_comment?: string;
  last_publication_at?: string | null;
  author: number | string | null;
  categories: string[];
  tags: string[];
  status: SitePostStatus;
  available_actions?: SitePostWorkflowAction[];
  published_at: string | null;
  created_at: string;
  updated_at: string;
  etag?: string;
}

export interface SitePostBlock {
  type: string;
  text?: string;
  html?: string;
  ref?: string;
  new_tab?: boolean;
  level?: number;
  label?: string;
  href?: string;
  alt?: string;
  items?: string[];
  style?: string;
  heading?: string;
  children?: SitePostBlock[];
}

export type SitePostWorkflowAction =
  | "submit" | "approve" | "reject" | "publish" | "unpublish" | "archive" | "restore";

export interface SiteTaxonomyRecord {
  id: string;
  site: number;
  code: string;
  name: string;
  slug: string;
  is_active: boolean;
}

export interface SitePostListQuery {
  search?: string;
  status?: SitePostStatus;
  category?: string;
  tag?: string;
  page?: number;
  page_size?: number;
  ordering?: "title" | "-title" | "created_at" | "-created_at" | "published_at" | "-published_at";
}

export interface SitePostListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: SitePostRecord[];
}

function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://backend:8000/api";
}

async function client() {
  const accessToken = await getAccessToken();
  return createApiClient({ baseUrl: apiBaseUrl(), accessToken: accessToken ?? undefined });
}

async function attempt<T>(run: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (cause) {
    return { ok: false, error: serializeApiError(cause) };
  }
}

function queryString(query: SitePostListQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

export async function loadSitePosts(
  siteId: number,
  query: SitePostListQuery = {},
): Promise<ActionResult<SitePostListResponse>> {
  return attempt(async () => {
    const api = await client();
    const listed = await api.get<SitePostListResponse>(
      `${sitePostsPath(siteId)}${queryString(query)}`,
    );
    return { ...listed, results: listed.results.filter((row) => row.site === siteId) };
  });
}

export async function loadSiteTaxonomy(
  siteId: number,
  kind: "categories" | "tags",
): Promise<ActionResult<SiteTaxonomyRecord[]>> {
  return attempt(async () => {
    const api = await client();
    const path = kind === "categories" ? siteCategoriesPath(siteId) : siteTagsPath(siteId);
    const rows: SiteTaxonomyRecord[] = [];
    let page = 1;
    let more = true;
    while (more) {
      const listed = await api.get<{ next: string | null; results: SiteTaxonomyRecord[] }>(
        `${path}?is_active=true&page_size=100&ordering=name&page=${page}`,
      );
      rows.push(...listed.results.filter(row => row.site === siteId && row.is_active));
      more = Boolean(listed.next);
      page += 1;
    }
    return rows;
  });
}

export async function getSitePost(
  siteId: number,
  postId: string,
): Promise<ActionResult<SitePostRecord>> {
  return attempt(async () => {
    const api = await client();
    const result = await api.getDetailed<SitePostRecord>(sitePostsPath(siteId, `${postId}/`));
    if (result.data.site !== siteId) throw new Error("The Post does not belong to this Site.");
    return { ...result.data, etag: result.etag ?? "" };
  });
}

export async function createSitePost(
  siteId: number,
  input: Pick<SitePostRecord, "title" | "slug" | "excerpt" | "seo" | "featured_media" | "categories" | "tags"> & Partial<Pick<SitePostRecord,"editor_document"|"content"|"blocks"|"featured_alt">>,
): Promise<ActionResult<SitePostRecord>> {
  return attempt(async () => {
    const api = await client();
    const result = await api.postDetailed<SitePostRecord>(sitePostsPath(siteId), input);
    return { ...result.data, etag: result.etag ?? "" };
  });
}

export async function updateSitePost(
  siteId: number,
  postId: string,
  ifMatch: string,
  input: Pick<SitePostRecord, "title" | "slug" | "excerpt" | "seo" | "featured_media" | "categories" | "tags"> & Partial<Pick<SitePostRecord,"editor_document"|"content"|"blocks"|"featured_alt">>,
): Promise<ActionResult<SitePostRecord>> {
  return attempt(async () => {
    const api = await client();
    const result = await api.patchDetailed<SitePostRecord>(
      sitePostsPath(siteId, `${postId}/`), input, { ifMatch },
    );
    return { ...result.data, etag: result.etag ?? "" };
  });
}

export interface SitePostWorkflowTransition {
  id: number;
  from_status: SitePostStatus;
  to_status: SitePostStatus;
  actor: number | null;
  comment: string;
  created_at: string;
}

export async function loadSitePostWorkflowHistory(
  siteId: number,
  postId: string,
): Promise<ActionResult<SitePostWorkflowTransition[]>> {
  return attempt(async () => {
    const api = await client();
    return api.get<SitePostWorkflowTransition[]>(sitePostWorkflowHistoryPath(siteId, postId));
  });
}

export async function transitionSitePost(
  siteId: number,
  postId: string,
  action: SitePostWorkflowAction,
  comment = "",
  ifMatch?: string,
): Promise<ActionResult<SitePostRecord>> {
  return attempt(async () => {
    const api = await client();
    const result = await api.postDetailed<SitePostRecord>(
      sitePostWorkflowPath(siteId, postId),
      { action, comment },
      ifMatch ? {headers:{"If-Match":ifMatch}} : undefined,
    );
    if (result.data.site !== siteId) throw new Error("The Post does not belong to this Site.");
    return { ...result.data, etag: result.etag ?? "" };
  });
}

export async function createSiteTaxonomy(
  siteId: number,
  kind: "categories" | "tags",
  input: { code: string; name: string; slug: string; is_active: true; locale: string },
): Promise<ActionResult<SiteTaxonomyRecord>> {
  return attempt(async () => {
    const api = await client();
    const path = kind === "categories" ? siteCategoriesPath(siteId) : siteTagsPath(siteId);
    const result = await api.postDetailed<SiteTaxonomyRecord>(path, input);
    if (result.data.site !== siteId) throw new Error("The taxonomy record does not belong to this Site.");
    return result.data;
  });
}


export async function openSitePostWorkingDraft(siteId:number,postId:string,ifMatch:string):Promise<ActionResult<SitePostRecord>> {
  return attempt(async () => {
    const result = await (await client()).postDetailed<SitePostRecord>(sitePostsPath(siteId,`${postId}/working-draft/`),undefined,{headers:{"If-Match":ifMatch}});
    if (result.data.site !== siteId) throw new Error("The article does not belong to this Site.");
    return {...result.data,etag:result.etag ?? ""};
  });
}

export async function getSitePostPreview(siteId:number,postId:string):Promise<ActionResult<SitePostRecord>> {
  return attempt(async () => {
    const result = await (await client()).getDetailed<SitePostRecord>(sitePostsPath(siteId,`${postId}/preview/`));
    if (result.data.site !== siteId) throw new Error("The article does not belong to this Site.");
    return {...result.data,etag:result.etag ?? ""};
  });
}
