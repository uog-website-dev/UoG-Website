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

export interface MenuRecord {
  id: string;
  site: number;
  location: string;
  name: string;
  is_active: boolean;
  is_global: boolean;
}

export interface MenuItemRecord {
  id: string;
  label: string;
  parent: string | null;
  sort_order: number;
  target: string;
  item_type: string;
  is_active: boolean;
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
      { headers: { "If-Match": ifMatch } },
    );
    return result.data;
  });
}

export async function createMenuLink(
  siteId: number,
  menuId: string,
  ifMatch: string,
  input: { label: string; target: string },
): Promise<ActionResult<MenuItemRecord>> {
  return attempt(async () => {
    const api = await client();
    const created = await api.postDetailed<MenuItemRecord>(
      siteMenuPath(siteId, `${menuId}/items/`),
      { label: input.label, item_type: "custom", target: input.target },
      { headers: { "If-Match": ifMatch } },
    );
    return created.data;
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
