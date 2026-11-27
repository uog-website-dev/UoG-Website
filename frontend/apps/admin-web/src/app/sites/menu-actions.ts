"use server";
import {invalidated} from "@/data/mutation-receipt";

import {serverApiFetch} from "@/performance/server-fetch";

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

export interface MenuRecord {
  id: string;
  site: number;
  location: string;
  code?: string;
  version?: number;
  has_unpublished_changes?: boolean;
  name: string;
  is_active: boolean;
  is_global: boolean;
}

export type MenuItemKind = "page" | "post" | "external" | "custom" | "news" | "category" | "docs" | "events";

export interface MenuItemRecord {
  id: string;
  label: string;
  parent: string | null;
  sort_order: number;
  target: string;
  item_type: MenuItemKind | string;
  page?: string | null;
  post?: string | null;
  category?: string | null;
  destination_status?: "ready" | "unavailable";
  is_active: boolean;
}

export interface MenuItemInput {
  label: string;
  item_type?: MenuItemKind;
  target?: string;
  page?: string | null;
  post?: string | null;
  category?: string | null;
  parent?: string | null;
}

export interface MenuTargetOption {
  id: string;
  label: string;
}

export interface MenuTargets {
  pages: MenuTargetOption[];
  posts: MenuTargetOption[];
  categories?: MenuTargetOption[];
  pagesAvailable: boolean;
  postsAvailable: boolean;
  documentsAvailable: boolean;
  eventsAvailable?: boolean;
}

export interface MenuLocationState {
  menu: MenuRecord;
  items: MenuItemRecord[];
  etag: string;
  itemsLoaded?: boolean;
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

export type MenuPlace = "" | "header" | "footer" | "sidebar" | "secondary";

function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://backend:8000/api";
}

async function client() {
  const accessToken = await getAccessToken();
  return createApiClient({fetchFn:serverApiFetch,
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

export async function loadSiteNavigation(siteId: number, includeItems = true): Promise<ActionResult<SiteNavigation>> {
  return attempt(async () => {
    const api = await client();
    const records: MenuRecord[] = [];
    let pageNumber = 1, more = true;
    while (more && pageNumber <= 100) {
      const page = await api.get<{ results: MenuRecord[]; next?: string | null }>(`${siteMenuPath(siteId)}?page_size=100${pageNumber > 1 ? `&page=${pageNumber}` : ""}`);
      records.push(...page.results.filter(menu => menu.site === siteId));
      more = Boolean(page.next); pageNumber++;
    }
    const menus: MenuLocationState[] = [];
    for (const menu of records) {
      if (!includeItems) {
        menus.push({ menu, items: [], etag: `"menu-${menu.id}-v${menu.version ?? 0}"`, itemsLoaded: false });
        continue;
      }
      const tree = await api.getDetailed<{ items: MenuItemRecord[] }>(
        siteMenuPath(siteId, `${menu.id}/tree/`),
      );
      if (!tree.etag) {
        throw new Error("The menu response did not include an ETag.");
      }
      menus.push({ menu, items: tree.data.items, etag: tree.etag });
    }
    const policies = await api.get<MenuInheritanceRecord[] | { results?: MenuInheritanceRecord[] }>(
      siteMenuInheritancePath(siteId),
    );
    const rows = Array.isArray(policies) ? policies : policies?.results;
    return { menus, inheritance: Array.isArray(rows) ? rows : [] };
  });
}

export async function loadSiteMenu(siteId: number, menuId: string): Promise<ActionResult<MenuLocationState>> {
  return attempt(async () => {
    const response = await (await client()).getDetailed<{menu: MenuRecord; items: MenuItemRecord[]}>(siteMenuPath(siteId, `${encodeURIComponent(menuId)}/tree/`));
    if (!response.etag || response.data.menu.site !== siteId || response.data.menu.id !== menuId) throw new Error("Menu is not available in this Site.");
    return { menu: response.data.menu, items: response.data.items, etag: response.etag, itemsLoaded: true };
  });
}

export async function createSiteMenu(
  siteId: number,
  location: MenuPlace,
  name?: string,
  code?: string,
): Promise<ActionResult<MenuRecord>> {
  return invalidated(siteId, "menus", attempt(async () => {
    const api = await client();
    const created = await api.postDetailed<MenuRecord>(siteMenuPath(siteId), {
      name: name?.trim() || (location === "header" ? "Header" : "Footer"),
      location,
      ...(code ? { code } : {}),
    });
    return created.data;
  }));
}

export async function updateSiteMenu(
  siteId: number,
  menuId: string,
  ifMatch: string,
  input: { name: string; location: MenuPlace },
): Promise<ActionResult<MenuRecord>> {
  return invalidated(siteId, "menus", attempt(async () => {
    const api = await client();
    const result = await api.patchDetailed<MenuRecord>(
      siteMenuPath(siteId, `${menuId}/`),
      { name: input.name, location: input.location },
      { ifMatch },
    );
    return result.data;
  }));
}

function itemBody(input: MenuItemInput): Record<string, unknown> {
  const kind = input.item_type ?? "custom";
  const body: Record<string, unknown> = {
    label: input.label,
    item_type: kind,
    page: kind === "page" ? input.page ?? null : null,
    post: kind === "post" ? input.post ?? null : null,
    category: kind === "category" ? input.category ?? null : null,
    target: ["page", "post", "category", "news", "docs", "events"].includes(kind) ? "" : input.target ?? "",
  };
  if (input.parent) body.parent = input.parent;
  return body;
}

export async function loadMenuTargets(siteId: number): Promise<ActionResult<MenuTargets>> {
  return attempt(async () => {
    const api = await client();
    return api.get<MenuTargets>(siteMenuPath(siteId, "targets/"));
  });
}

export async function createMenuLink(
  siteId: number,
  menuId: string,
  ifMatch: string,
  input: MenuItemInput,
): Promise<ActionResult<MenuItemRecord>> {
  return invalidated(siteId, "menus", attempt(async () => {
    const api = await client();
    const created = await api.postDetailed<MenuItemRecord>(
      siteMenuPath(siteId, `${menuId}/items/`),
      itemBody(input),
      { headers: { "If-Match": ifMatch } },
    );
    return created.data;
  }));
}

export async function updateMenuItem(
  siteId: number,
  menuId: string,
  itemId: string,
  ifMatch: string,
  input: MenuItemInput,
): Promise<ActionResult<MenuItemRecord>> {
  return invalidated(siteId, "menus", attempt(async () => {
    const api = await client();
    const result = await api.patchDetailed<MenuItemRecord>(
      siteMenuPath(siteId, `${menuId}/items/${itemId}/`),
      itemBody({ ...input, parent: null }),
      { ifMatch },
    );
    return result.data;
  }));
}

export async function deleteMenuItem(
  siteId: number,
  menuId: string,
  itemId: string,
  ifMatch: string,
): Promise<ActionResult<{ etag: string | null }>> {
  return invalidated(siteId, "menus", attempt(async () => {
    const api = await client();
    const result = await api.delDetailed(
      siteMenuPath(siteId, `${menuId}/items/${itemId}/`),
      { ifMatch },
    );
    return { etag: result.etag };
  }));
}

export async function moveMenuItem(
  siteId: number,
  menuId: string,
  itemId: string,
  ifMatch: string,
  parent: string | null,
  position: number,
): Promise<ActionResult<{ etag: string | null }>> {
  return invalidated(siteId, "menus", attempt(async () => {
    const api = await client();
    const result = await api.postDetailed(
      siteMenuPath(siteId, `${menuId}/items/${itemId}/move/`),
      { parent, position },
      { headers: { "If-Match": ifMatch } },
    );
    return { etag: result.etag };
  }));
}

export async function reorderSiteMenu(
  siteId: number,
  menuId: string,
  ifMatch: string,
  parent: string | null,
  items: string[],
): Promise<ActionResult<{ etag: string | null }>> {
  return invalidated(siteId, "menus", attempt(async () => {
    const api = await client();
    const result = await api.postDetailed(
      siteMenuPath(siteId, `${menuId}/reorder/`),
      { parent, items },
      { headers: { "If-Match": ifMatch } },
    );
    return { etag: result.etag };
  }));
}

export async function setMenuActive(
  siteId: number,
  menuId: string,
  ifMatch: string,
  active: boolean,
): Promise<ActionResult<MenuRecord>> {
  return invalidated(siteId, "menus", attempt(async () => {
    const api = await client();
    const result = await api.postDetailed<MenuRecord>(
      siteMenuPath(siteId, `${menuId}/${active ? "activate" : "deactivate"}/`),
      {},
      { headers: { "If-Match": ifMatch } },
    );
    return result.data;
  }));
}

export interface MenuLocationRecord {
  location: string; label: string; version: number;
  draft_menu: string | null; published_menu: string | null;
  draft_menus?: string[]; published_menus?: string[];
  is_published: boolean; has_changes: boolean;
}
export async function loadMenuLocations(site: number): Promise<ActionResult<MenuLocationRecord[]>> {
  return attempt(async () => (await client()).get<MenuLocationRecord[]>(siteMenuPath(site,"locations/")));
}
export async function saveMenuLocation(site: number, location: string, version: number, menu: string | null, replace: boolean): Promise<ActionResult<MenuLocationRecord>> {
  return invalidated(site, "menus", attempt(async () => (await client()).post<MenuLocationRecord>(siteMenuPath(site,`locations/${encodeURIComponent(location)}/draft/`),{version,menu,replace})));
}
export async function publishMenuLocation(site: number, location: string, version: number): Promise<ActionResult<MenuLocationRecord>> {
  return invalidated(site, "menus", attempt(async () => (await client()).post<MenuLocationRecord>(siteMenuPath(site,`locations/${encodeURIComponent(location)}/publish/`),{version})));
}

export interface NavigationPreview {
 site:number;name:string;public_origin:string|null;preview:boolean;menu_version?:number;theme?:"institutional"|"high-contrast";
 locations:Record<string,unknown[]>;
}
export async function loadNavigationPreview(site:number,menu?:string):Promise<ActionResult<NavigationPreview>> {
 return attempt(async()=> {
  const data=await (await client()).get<NavigationPreview>(siteMenuPath(site,menu?`${encodeURIComponent(menu)}/preview/`:"preview-navigation/"));
  if(!data||data.site!==site||data.preview!==true||!data.locations||typeof data.locations!=="object"||Array.isArray(data.locations))throw new Error("Preview is not available in this Site.");
  return data;
 });
}


export async function saveFooterMenus(site: number, version: number, menus: string[], replace: boolean): Promise<ActionResult<MenuLocationRecord>> {
  return invalidated(site, "menus", attempt(async () => (await client()).post<MenuLocationRecord>(siteMenuPath(site,"locations/footer/draft/"),{version,menus,replace})));
}
