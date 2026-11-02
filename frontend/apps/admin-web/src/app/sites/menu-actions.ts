"use server";

/**
 * Site-scoped menu administration.
 *
 * Every path is built from the Site id argument. These actions do not accept
 * a second Site, and they do not grant access to a parent or sibling menu.
 * The Keycloak token stays on the server.
 */
import { createApiClient } from "@uog/api-client";

import { getAccessToken } from "@/access-token";
import { serializeApiError } from "@/organizations/contract";
import type { ActionResult } from "@/organizations/contract";
import { siteMenuInheritancePath, siteMenuPath } from "@/sites/menu-paths";
import { sitePagePath } from "@/sites/page-paths";
import { sitePostsPath } from "@/sites/post-paths";

export interface MenuRecord {
  id: string;
  site: number;
  location: string;
  name: string;
  is_active: boolean;
  is_global: boolean;
}

export type MenuItemKind = "page" | "post" | "external" | "custom";

export interface MenuItemRecord {
  id: string;
  label: string;
  parent: string | null;
  sort_order: number;
  target: string;
  item_type: MenuItemKind | string;
  page?: string | null;
  post?: string | null;
  is_active: boolean;
}

export interface MenuItemInput {
  label: string;
  item_type?: MenuItemKind;
  target?: string;
  page?: string | null;
  post?: string | null;
  parent?: string | null;
}

export interface MenuTargetOption {
  id: string;
  label: string;
}

export interface MenuTargets {
  pages: MenuTargetOption[];
  posts: MenuTargetOption[];
  pagesAvailable: boolean;
  postsAvailable: boolean;
}

export interface MenuLocationState {
  menu: MenuRecord;
  items: MenuItemRecord[];
  etag: string;
}

export interface MenuInheritanceRecord {
  id: string;
  site: number;
  location: string;
  inherit_from: number | null;
  include_global: boolean;
  local_precedence: string;
}

export interface SiteNavigation {
  menus: MenuLocationState[];
  inheritance: MenuInheritanceRecord[];
}

export type MenuPlace = "header" | "footer";

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

export async function loadSiteNavigation(siteId: number): Promise<ActionResult<SiteNavigation>> {
  return attempt(async () => {
    const api = await client();
    const page = await api.get<{ results: MenuRecord[] }>(
      `${siteMenuPath(siteId)}?page_size=100`,
    );
    const menus: MenuLocationState[] = [];
    for (const menu of page.results) {
      const tree = await api.getDetailed<{ items: MenuItemRecord[] }>(
        siteMenuPath(siteId, `${menu.id}/tree/`),
      );
      if (!tree.etag) {
        throw new Error("The menu response did not include an ETag.");
      }
      menus.push({ menu, items: tree.data.items, etag: tree.etag });
    }
    const policies = await api.get<MenuInheritanceRecord[]>(siteMenuInheritancePath(siteId));
    return { menus, inheritance: Array.isArray(policies) ? policies : [] };
  });
}

export async function createSiteMenu(
  siteId: number,
  location: MenuPlace,
  name?: string,
): Promise<ActionResult<MenuRecord>> {
  return attempt(async () => {
    const api = await client();
    const created = await api.postDetailed<MenuRecord>(siteMenuPath(siteId), {
      name: name?.trim() || (location === "header" ? "Header" : "Footer"),
      location,
    });
    return created.data;
  });
}

export async function updateSiteMenu(
  siteId: number,
  menuId: string,
  ifMatch: string,
  input: { name: string; location: MenuPlace },
): Promise<ActionResult<MenuRecord>> {
  return attempt(async () => {
    const api = await client();
    const result = await api.patchDetailed<MenuRecord>(
      siteMenuPath(siteId, `${menuId}/`),
      { name: input.name, location: input.location },
      { ifMatch },
    );
    return result.data;
  });
}

function itemBody(input: MenuItemInput): Record<string, unknown> {
  const kind = input.item_type ?? "custom";
  const body: Record<string, unknown> = {
    label: input.label,
    item_type: kind,
    page: kind === "page" ? input.page ?? null : null,
    post: kind === "post" ? input.post ?? null : null,
    target: kind === "page" || kind === "post" ? "" : input.target ?? "",
  };
  if (input.parent) body.parent = input.parent;
  return body;
}

export async function loadMenuTargets(siteId: number): Promise<ActionResult<MenuTargets>> {
  return attempt(async () => {
    const api = await client();
    async function options(path: string): Promise<MenuTargetOption[] | null> {
      try {
        const page = await api.get<{ results: { id: string; title: string }[] }>(
          `${path}?page_size=100`,
        );
        return page.results.map((row) => ({ id: row.id, label: row.title }));
      } catch {
        return null;
      }
    }
    const pages = await options(sitePagePath(siteId));
    const posts = await options(sitePostsPath(siteId));
    return {
      pages: pages ?? [],
      posts: posts ?? [],
      pagesAvailable: pages !== null,
      postsAvailable: posts !== null,
    };
  });
}

export async function createMenuLink(
  siteId: number,
  menuId: string,
  ifMatch: string,
  input: MenuItemInput,
): Promise<ActionResult<MenuItemRecord>> {
  return attempt(async () => {
    const api = await client();
    const created = await api.postDetailed<MenuItemRecord>(
      siteMenuPath(siteId, `${menuId}/items/`),
      itemBody(input),
      { headers: { "If-Match": ifMatch } },
    );
    return created.data;
  });
}

export async function updateMenuItem(
  siteId: number,
  menuId: string,
  itemId: string,
  ifMatch: string,
  input: MenuItemInput,
): Promise<ActionResult<MenuItemRecord>> {
  return attempt(async () => {
    const api = await client();
    const result = await api.patchDetailed<MenuItemRecord>(
      siteMenuPath(siteId, `${menuId}/items/${itemId}/`),
      itemBody({ ...input, parent: null }),
      { ifMatch },
    );
    return result.data;
  });
}

export async function deleteMenuItem(
  siteId: number,
  menuId: string,
  itemId: string,
  ifMatch: string,
): Promise<ActionResult<{ etag: string | null }>> {
  return attempt(async () => {
    const api = await client();
    const result = await api.delDetailed(
      siteMenuPath(siteId, `${menuId}/items/${itemId}/`),
      { ifMatch },
    );
    return { etag: result.etag };
  });
}

export async function moveMenuItem(
  siteId: number,
  menuId: string,
  itemId: string,
  ifMatch: string,
  parent: string | null,
  position: number,
): Promise<ActionResult<{ etag: string | null }>> {
  return attempt(async () => {
    const api = await client();
    const result = await api.postDetailed(
      siteMenuPath(siteId, `${menuId}/items/${itemId}/move/`),
      { parent, position },
      { headers: { "If-Match": ifMatch } },
    );
    return { etag: result.etag };
  });
}

export async function reorderSiteMenu(
  siteId: number,
  menuId: string,
  ifMatch: string,
  parent: string | null,
  items: string[],
): Promise<ActionResult<{ etag: string | null }>> {
  return attempt(async () => {
    const api = await client();
    const result = await api.postDetailed(
      siteMenuPath(siteId, `${menuId}/reorder/`),
      { parent, items },
      { headers: { "If-Match": ifMatch } },
    );
    return { etag: result.etag };
  });
}

export async function setMenuActive(
  siteId: number,
  menuId: string,
  ifMatch: string,
  active: boolean,
): Promise<ActionResult<MenuRecord>> {
  return attempt(async () => {
    const api = await client();
    const result = await api.postDetailed<MenuRecord>(
      siteMenuPath(siteId, `${menuId}/${active ? "activate" : "deactivate"}/`),
      {},
      { headers: { "If-Match": ifMatch } },
    );
    return result.data;
  });
}
