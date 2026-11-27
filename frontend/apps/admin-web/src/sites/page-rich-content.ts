/**
 * Convert between the shared WYSIWYG HTML body and CMS Page blocks.
 *
 * Page and Post create/edit forms share one RichTextEditor. Posts persist the
 * HTML as `editor_document`; Pages convert to/from the existing block list so
 * public rendering stays unchanged. Complex Page layouts remain in the Visual
 * Builder — this path only covers the simple content column.
 */
import type { SitePageBlock } from "@/app/sites/page-actions";
import { assetIdFromImageRef, imageRefForAsset } from "@/sites/site-image-field";

const MAX_HEADING = 400;
const MAX_LIST_ITEMS = 50;
const MAX_LIST_ITEM = 1_200;
const MAX_ALT = 255;

/** Block types the shared Rich Text Editor owns (leading run on a Page). */
const RICH_TEXT_BLOCK_TYPES = new Set(["paragraph", "heading", "list", "image"]);

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
  const style = (element.getAttribute("style") ?? "").trim();
  return {
    type: "image",
    ref: imageRefForAsset(siteId, assetId),
    alt,
    ...(style ? { style } : {}),
  };
}

export function isRichTextPageBlock(block: SitePageBlock): boolean {
  return RICH_TEXT_BLOCK_TYPES.has(block.type);
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
    } else if (tag === "table") {
      blocks.push({ type: "paragraph", html: element.outerHTML });
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

function escapeAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Rebuild editor HTML from the leading rich-text Page blocks. */
export function htmlFromPageBlocks(blocks: SitePageBlock[], siteId: number): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "heading" && block.text) {
      const level = block.level === 3 || block.level === 4 ? block.level : 2;
      parts.push(`<h${level}>${escapeHtml(block.text)}</h${level}>`);
      continue;
    }
    if (block.type === "paragraph" && block.html) {
      parts.push(block.html);
      continue;
    }
    if (block.type === "list" && block.items?.length) {
      const tag = block.style === "ordered" ? "ol" : "ul";
      const items = block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
      parts.push(`<${tag}>${items}</${tag}>`);
      continue;
    }
    if (block.type === "image" && block.ref) {
      const assetId = assetIdFromImageRef(block.ref, siteId);
      if (!assetId) continue;
      const alt = (block.alt ?? "Image").slice(0, MAX_ALT);
      const style = block.style?.trim() ? ` style="${escapeAttr(block.style.trim())}"` : "";
      parts.push(
        `<img data-asset-id="${escapeAttr(assetId)}" data-node-id="${crypto.randomUUID()}" alt="${escapeAttr(alt)}"${style}>`,
      );
    }
  }
  return parts.join("");
}

/**
 * Split a Page's blocks into the shared editor body (leading rich-text run)
 * and remaining structured blocks (buttons, sections, sliders, galleries).
 * Matches the create-form save order: rich HTML first, extras after.
 */
export function splitPageBlocksForEditor(
  blocks: SitePageBlock[],
  siteId: number,
): { html: string; structured: SitePageBlock[] } {
  let cut = 0;
  while (cut < blocks.length && isRichTextPageBlock(blocks[cut]!)) cut += 1;
  return {
    html: htmlFromPageBlocks(blocks.slice(0, cut), siteId),
    structured: blocks.slice(cut),
  };
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
