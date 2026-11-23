import type { Metadata } from "next";
import { headers } from "next/headers";
import { cache } from "react";
import * as http from "node:http";
import * as https from "node:https";
import { EMPTY_SITE, menuPayloadForSite, pageMetadata, postMetadata, safePagePath, siteFromContext } from "@uog/ui/public-site";
import type { PublicMenusPayload, PublicSiteContext } from "@uog/ui/public-site";

const API = process.env.API_BASE_URL ?? "http://backend:8000/api";

async function requestPublicApi(path: string, host: string): Promise<{ status: number; body: unknown } | null> {
  try {
    const url = new URL(`${API}/v1/site-context/${path}`);
    const transport = url.protocol === "https:" ? https : http;
    return await new Promise((resolve, reject) => {
      const request = transport.request(url, {
        method: "GET",
        headers: { Accept: "application/json", Host: host },
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          let body: unknown = null;
          try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* invalid JSON stays unavailable */ }
          resolve({ status: response.statusCode ?? 0, body });
        });
      });
      request.on("error", reject);
      request.end();
    });
  } catch { return null; }
}

/** Resolve public Site branding from the request Host without accepting Site ids. */
export async function publicSiteForHost(host: string | null): Promise<PublicSiteContext> {
  if (!host || /[\s,/@\\]/.test(host)) return EMPTY_SITE;
  const response = await requestPublicApi("", host);
  return siteFromContext(response?.status ?? 0, response?.body ?? null);
}

/**
 * Server-rendered menus for the Host-resolved Site.
 *
 * Request-scoped React cache keyed by both Host and Site id: one fetch per
 * request, never a cross-request copy that could outlive a menu publication.
 * The backend keeps the delivery cache and bumps it when a menu or location is
 * published. A 404 (MENUS disabled or unknown Host) and any payload for a
 * different Site fail closed to no navigation.
 */
export const publicMenusForHost = cache(async (host: string | null, siteId: number | null): Promise<PublicMenusPayload | null> => {
  if (!host || !siteId || /[\s,/@\\]/.test(host)) return null;
  const response = await requestPublicApi("menus/", host);
  if (!response || response.status !== 200) return null;
  return menuPayloadForSite(response.body, siteId);
});

async function resolvedSite(): Promise<{ site: PublicSiteContext; origin: string } | null> {
  const incoming = await headers();
  const requestHost = incoming.get("host");
  try {
    const site = await publicSiteForHost(requestHost);
    if (!site.id || !site.canonicalDomain) return null;
    const forwarded = incoming.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const localHost = site.canonicalDomain === "localhost" || site.canonicalDomain.endsWith(".uog.local");
    const scheme = forwarded === "http" || forwarded === "https" ? forwarded : localHost ? "http" : "https";
    return { site, origin: `${scheme}://${site.canonicalDomain}` };
  } catch { return null; }
}

async function publicDocument(path: string): Promise<{ status: number; body: unknown } | null> {
  try {
    const host = (await headers()).get("host");
    if (!host || /[\s,/@\\]/.test(host)) return null;
    return await requestPublicApi(path, host);
  } catch { return null; }
}

export async function pageRouteMetadata(path: string): Promise<Metadata> {
  const resolved = await resolvedSite();
  if (!resolved || !resolved.site.modules.pages) return {};
  const response = await publicDocument(`pages${path}/`);
  if (!response || response.status !== 200) return {};
  const page = pageForMetadata(response.body);
  const route = page ? safePagePath(page.path.split("/").filter(Boolean)) : null;
  if (!page || page.site !== resolved.site.id || !route) return {};
  const canonical = new URL(route, resolved.origin).toString();
  const values = pageMetadata(resolved.site, page);
  return { title: values.title, description: values.description, alternates: { canonical }, openGraph: { type: "website", url: canonical, title: values.title, description: values.description } };
}

export async function postRouteMetadata(slug: string): Promise<Metadata> {
  const resolved = await resolvedSite();
  if (!resolved || !resolved.site.modules.posts || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return {};
  const response = await publicDocument(`posts/${encodeURIComponent(slug)}/`);
  if (!response || response.status !== 200) return {};
  const post = postForMetadata(response.body);
  if (!post || post.site !== resolved.site.id) return {};
  const canonical = new URL(`/posts/${post.slug}`, resolved.origin).toString();
  const values = postMetadata(resolved.site, post);
  return { title: values.title, description: values.description, alternates: { canonical }, openGraph: { type: "article", url: canonical, title: values.title, description: values.description } };
}

function plainText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function seoValues(value: unknown) {
  const seo = record(value) ?? {};
  return { title: plainText(seo.meta_title, 120), description: plainText(seo.meta_description, 300) };
}

function pageForMetadata(value: unknown): { title: string; path: string; site: number | null; seo: { title: string; description: string } } | null {
  const row = record(value);
  if (!row || (row.status != null && row.status !== "PUBLISHED") || typeof row.title !== "string" || typeof row.path !== "string") return null;
  return { title: plainText(row.title, 255), path: row.path, site: typeof row.site === "number" ? row.site : null, seo: seoValues(row.seo) };
}

function postForMetadata(value: unknown): { title: string; slug: string; excerpt: string; site: number | null; seo: { title: string; description: string } } | null {
  const row = record(value);
  if (!row || (row.status != null && row.status !== "PUBLISHED") || typeof row.title !== "string" || typeof row.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug)) return null;
  return { title: plainText(row.title, 255), slug: row.slug, excerpt: typeof row.excerpt === "string" ? plainText(row.excerpt, 300) : "", site: typeof row.site === "number" ? row.site : null, seo: seoValues(row.seo) };
}
