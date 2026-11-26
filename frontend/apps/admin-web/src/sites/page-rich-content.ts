/**
 * Convert the WYSIWYG Page body into the CMS Page block list.
 *
 * The Page editor writes body HTML through the same article document contract
 * as Posts, so the markup here is already normalized: paragraphs, headings,
 * lists, quotes, links and asset images. Blocks keep public rendering working
 * without teaching the renderer a second content format.
 */
import type { SitePageBlock } from "@/app/sites/page-actions";
import { imageRefForAsset } from "@/sites/site-image-field";

const MAX_HEADING = 400;
const MAX_LIST_ITEMS = 50;
const MAX_LIST_ITEM = 1_200;
const MAX_ALT = 255;

function textOf(node: Node): string {
  return (node.textContent ?? "").replace(/\s+/g, " ").trim();
}

function paragraphFor(element: Element): SitePageBlock | null {
  if (!textOf(element)) return null;
  return { type: "paragraph", html: element.outerHTML };
}

function headingFor(element: Element): SitePageBlock | null {
  const text = textOf(element).slice(0, MAX_HEADING);
  if (!text) return null;
  const raw = Number(element.tagName.slice(1));
  const level = raw === 3 || raw === 4 ? raw : 2;
  return { type: "heading", level, text };
}

function listFor(element: Element): SitePageBlock | null {
  const items = Array.from(element.querySelectorAll(":scope > li"))
    .map((item) => textOf(item).slice(0, MAX_LIST_ITEM))
    .filter(Boolean)
    .slice(0, MAX_LIST_ITEMS);
  if (items.length === 0) return null;
  return {
    type: "list",
    style: element.tagName.toLowerCase() === "ol" ? "ordered" : "unordered",
    items,
  };
}

function imageFor(element: Element, siteId: number): SitePageBlock | null {
  const assetId = element.getAttribute("data-asset-id")?.trim() ?? "";
  if (!assetId) return null;
  const alt = (element.getAttribute("alt") ?? "").trim().slice(0, MAX_ALT) || "Image";
  return { type: "image", ref: imageRefForAsset(siteId, assetId), alt };
}

/**
 * Top-level nodes become blocks in reading order. A leading inline run (for
 * example bare text or a lone link) is wrapped in a paragraph so it is not
 * dropped.
 */
export function richTextBlocksFromHtml(html: string, siteId: number): SitePageBlock[] {
  if (!html.trim() || typeof DOMParser === "undefined") return [];
  const document = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const blocks: SitePageBlock[] = [];
  for (const node of Array.from(document.body.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = textOf(node);
      if (value) blocks.push({ type: "paragraph", html: `<p>${escapeHtml(value)}</p>` });
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const heading = headingFor(element);
      if (heading) blocks.push(heading);
    } else if (tag === "ul" || tag === "ol") {
      const list = listFor(element);
      if (list) blocks.push(list);
    } else if (tag === "img") {
      const image = imageFor(element, siteId);
      if (image) blocks.push(image);
    } else if (tag === "p" || tag === "div" || tag === "blockquote") {
      const paragraph = paragraphFor(element);
      if (paragraph) blocks.push(paragraph);
    } else {
      const label = textOf(element);
      if (label) blocks.push({ type: "paragraph", html: `<p>${element.outerHTML}</p>` });
    }
  }
  return blocks;
}

/** True when the body has no visible text and no image. */
export function richTextIsEmpty(html: string): boolean {
  return !html || !html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
