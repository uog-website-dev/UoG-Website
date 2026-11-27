"use client";

import { createElement, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { parseFragment } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import Box from "@mui/material/Box";
import { safeMenuHref } from "./site-navigation";
import { sanitizeInlineStyle } from "./article-style";

export interface ArticleDocument {
  schema_version: 1;
  html: string;
}
type HtmlNode = DefaultTreeAdapterMap["childNode"];
type ArticleNode = {
  tag: string;
  text?: string;
  href?: string;
  title?: string;
  assetId?: string;
  nodeId?: string;
  alt?: string;
  style?: string;
  colspan?: string;
  rowspan?: string;
  children?: ArticleNode[];
};
/** Keep in sync with backend apps.api.post_editor.MAX_* */
export const ARTICLE_MAX_BYTES = 200_000;
export const ARTICLE_MAX_ELEMENTS = 2_000;
export const ARTICLE_MAX_DEPTH = 16;

const allowed = new Set([
  "p",
  "br",
  "h2",
  "h3",
  "h4",
  "strong",
  "em",
  "u",
  "s",
  "mark",
  "span",
  "ul",
  "ol",
  "li",
  "blockquote",
  "a",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
]);
const removed = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "svg",
  "math",
  "template",
]);
const styleTags = new Set(["span", "mark", "p", "h2", "h3", "h4", "table", "th", "td", "tr", "img"]);

export function articleHref(value: string): string | null {
  if (/^mailto:[a-z0-9.!%+_-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value))
    return value;
  if (value.startsWith("#")) return null;
  return safeMenuHref(value);
}

function attr(node: DefaultTreeAdapterMap["element"], name: string): string {
  return node.attrs.find((entry) => entry.name === name)?.value ?? "";
}

function nodesFrom(html: string): ArticleNode[] {
  if (
    typeof html !== "string" ||
    new TextEncoder().encode(html).length > ARTICLE_MAX_BYTES
  )
    throw new Error("The article exceeds the editor size limit.");
  let count = 0;
  const imageNodes = new Set<string>();
  function visit(nodes: HtmlNode[], depth: number): ArticleNode[] {
    if (depth > ARTICLE_MAX_DEPTH) throw new Error("The article structure is too deep.");
    return nodes.flatMap((node) => {
      if (++count > ARTICLE_MAX_ELEMENTS) throw new Error("The article has too many elements.");
      if (node.nodeName === "#text")
        return [
          {
            tag: "text",
            text: (node as DefaultTreeAdapterMap["textNode"]).value,
          },
        ];
      if (!("tagName" in node)) return [];
      if (removed.has(node.tagName)) return [];
      if (node.tagName === "img") {
        const assetId = attr(node, "data-asset-id");
        if (!assetId) return [];
        const nodeId = attr(node, "data-node-id");
        const alt = attr(node, "alt").trim();
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuid.test(assetId) || !uuid.test(nodeId) || !alt || alt.length > 1000)
          throw new Error("Images require an asset, unique placement ID and alternative text.");
        if (imageNodes.has(nodeId.toLowerCase())) throw new Error("Image placement identifiers must be unique.");
        imageNodes.add(nodeId.toLowerCase());
        const style = sanitizeInlineStyle(attr(node, "style"));
        return [{ tag: "img", assetId, nodeId, alt, ...(style ? { style } : {}) }];
      }
      // Browsers often wrap foreColor as <font color>, which we normalize to span.
      if (node.tagName === "font") {
        const children = visit(node.childNodes, depth + 1);
        const color = attr(node, "color").trim();
        const style = sanitizeInlineStyle(
          [color ? `color: ${color}` : "", attr(node, "style")].filter(Boolean).join("; "),
        );
        if (!style) return children;
        return [{ tag: "span", style, children }];
      }
      const children = visit(node.childNodes, depth + 1);
      const tag =
        ({ b: "strong", i: "em", div: "p" } as Record<string, string>)[
          node.tagName
        ] ?? node.tagName;
      if (!allowed.has(tag)) return children;
      const href =
        tag === "a"
          ? articleHref(attr(node, "href"))
          : null;
      if (tag === "a" && !href) return children;
      const style = styleTags.has(tag) ? sanitizeInlineStyle(attr(node, "style")) : "";
      const colspan = tag === "td" || tag === "th" ? attr(node, "colspan") : "";
      const rowspan = tag === "td" || tag === "th" ? attr(node, "rowspan") : "";
      return [
        {
          tag,
          children,
          ...(href
            ? { href, title: attr(node, "title") || undefined }
            : {}),
          ...(style ? { style } : {}),
          ...(colspan && /^[1-9]\d{0,1}$/.test(colspan) ? { colspan } : {}),
          ...(rowspan && /^[1-9]\d{0,1}$/.test(rowspan) ? { rowspan } : {}),
        },
      ];
    });
  }
  return visit(parseFragment(html).childNodes, 0);
}
const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
function serialize(nodes: ArticleNode[]): string {
  return nodes
    .map((node) => {
      if (node.tag === "text") return escape(node.text ?? "");
      if (node.tag === "br") return "<br>";
      if (node.tag === "img") {
        const style = node.style ? ` style="${escape(node.style)}"` : "";
        return `<img data-asset-id="${escape(node.assetId!)}" data-node-id="${escape(node.nodeId!)}" alt="${escape(node.alt!)}"${style}>`;
      }
      const attributes = [
        node.href
          ? ` href="${escape(node.href)}"${node.title ? ` title="${escape(node.title)}"` : ""} rel="noopener noreferrer"`
          : "",
        node.style ? ` style="${escape(node.style)}"` : "",
        node.colspan ? ` colspan="${escape(node.colspan)}"` : "",
        node.rowspan ? ` rowspan="${escape(node.rowspan)}"` : "",
      ].join("");
      return `<${node.tag}${attributes}>${serialize(node.children ?? [])}</${node.tag}>`;
    })
    .join("");
}
function articleDisplayBlocks(nodes: ArticleNode[]): ArticleNode[] {
  const textContent = (node: ArticleNode): string =>
    node.tag === "text"
      ? node.text ?? ""
      : (node.children ?? []).map(textContent).join("");
  const containsImage = (node: ArticleNode): boolean =>
    node.tag === "img" || (node.children ?? []).some(containsImage);
  const inlineTags = new Set(["text", "br", "strong", "em", "u", "s", "mark", "span", "a", "img"]);

  return nodes.flatMap((node) => {
    const text = textContent(node).trim();
    const hasImage = containsImage(node);
    if ((node.tag === "p" || node.tag === "h2" || node.tag === "h3" || node.tag === "h4") && !text && !hasImage)
      return [];

    if (
      (node.tag === "h2" || node.tag === "h3" || node.tag === "h4") &&
      (text.length > 180 || hasImage) &&
      (node.children ?? []).every((child) => inlineTags.has(child.tag))
    ) {
      const paragraphs: ArticleNode[][] = [[]];
      for (const child of node.children ?? []) {
        if (child.tag === "br") {
          if (paragraphs[paragraphs.length - 1]!.length > 0) paragraphs.push([]);
        } else {
          paragraphs[paragraphs.length - 1]!.push(child);
        }
      }
      return paragraphs
        .filter((children) => children.some((child) => child.tag !== "text" || Boolean(child.text?.trim())))
        .map((children) => ({ tag: "p", children }));
    }

    return [node];
  });
}
export function normalizeArticleDocument(value: unknown): ArticleDocument {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The article document is invalid.");
  const record = value as Record<string, unknown>;
  if (
    record.schema_version !== 1 ||
    typeof record.html !== "string" ||
    Object.keys(record).some((key) => !["schema_version", "html"].includes(key))
  )
    throw new Error("This article document version is unsupported.");
  return { schema_version: 1, html: serialize(nodesFrom(record.html)) };
}
export function articlePlainText(html: string): string {
  const text = (nodes: ArticleNode[]): string =>
    nodes
      .map((node) =>
        node.tag === "text" ? node.text : text(node.children ?? []),
      )
      .join(" ");
  return text(nodesFrom(html)).replace(/\s+/g, " ").trim();
}
export function ArticleAssetImage({
  assetId,
  alt,
  siteId,
  mediaBase,
  style,
}: {
  assetId: string;
  alt: string;
  siteId: number;
  mediaBase?: string;
  style?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = mediaBase ? `${mediaBase}/${assetId}/image?variant=display` : `/api/v1/site-context/media/${assetId}/?variant=display`;
  if (failed) return <Box role="status">Image unavailable. {alt}</Box>;
  return (
    <Box
      component="img"
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      style={style ? Object.fromEntries(
        style.split(";").filter(Boolean).map((part) => {
          const [prop, ...rest] = part.split(":");
          const key = (prop ?? "").trim().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
          return [key, rest.join(":").trim()];
        }).filter(([key, value]) => key && value),
      ) as CSSProperties : undefined}
      sx={{ maxWidth: "100%", height: "auto", borderRadius: 1.5, my: style ? 0 : 3 }}
    />
  );
}

export function ArticleDocumentView({
  document,
  siteId,
  mediaBase,
  maxWidth = "75ch",
}: {
  document: unknown;
  siteId?: number;
  mediaBase?: string;
  /** Reading measure for editor previews; public posts pass `none` to match the featured column. */
  maxWidth?: string | number;
}) {
  let nodes: ArticleNode[];
  try {
    nodes = articleDisplayBlocks(nodesFrom(normalizeArticleDocument(document).html));
  } catch {
    return <Box role="status">This article content is unavailable.</Box>;
  }
  const render = (values: ArticleNode[]): ReactNode =>
    values.map((node, index) =>
      node.tag === "text"
        ? node.text
        : node.tag === "img"
        ? siteId ? (
            <ArticleAssetImage
              key={`${node.nodeId}:${node.assetId}`}
              assetId={node.assetId!}
              alt={node.alt!}
              siteId={siteId}
              mediaBase={mediaBase}
              style={node.style}
            />
          ) : (
            <Box key={index}>Image unavailable. {node.alt}</Box>
          )
        : createElement(
            node.tag,
            {
              key: index,
              ...(node.href
                ? {
                    href: node.href,
                    title: node.title,
                    rel: "noopener noreferrer",
                  }
                : {}),
              ...(node.style ? { style: Object.fromEntries(
                node.style.split(";").filter(Boolean).map((part) => {
                  const [prop, ...rest] = part.split(":");
                  const key = (prop ?? "").trim().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
                  return [key, rest.join(":").trim()];
                }).filter(([key, value]) => key && value),
              ) } : {}),
              ...(node.colspan ? { colSpan: Number(node.colspan) } : {}),
              ...(node.rowspan ? { rowSpan: Number(node.rowspan) } : {}),
            },
            node.tag === "br" ? undefined : render(node.children ?? []),
          ),
    );
  return (
    <Box
      data-article-version="1"
      sx={{
        maxWidth,
        width: maxWidth === "none" ? "100%" : undefined,
        overflowWrap: "anywhere",
        lineHeight: 1.8,
        color: "text.primary",
        "& > p": { my: 0, mb: 2.5, fontSize: { xs: "1.05rem", md: "1.125rem" }, lineHeight: 1.85 },
        "& > h2": { mt: 4, mb: 1.5, fontSize: "clamp(1.5rem,3vw,2rem)", lineHeight: 1.25, fontWeight: 700 },
        "& > h3": { mt: 3, mb: 1.25, fontSize: "1.35rem", lineHeight: 1.35, fontWeight: 700 },
        "& > h4": { mt: 2.5, mb: 1, fontSize: "1.15rem", lineHeight: 1.4, fontWeight: 700 },
        "& > ul, & > ol": { pl: 3, my: 2.5, fontSize: { xs: "1.05rem", md: "1.125rem" }, lineHeight: 1.8 },
        "& li + li": { mt: 0.75 },
        "& blockquote": {
          borderLeft: "4px solid",
          borderColor: "primary.main",
          pl: 3,
          ml: 0,
          py: 1,
          borderRadius: 1,
          bgcolor: "action.hover",
          color: "text.secondary",
        },
        "& table": {
          width: "100%",
          borderCollapse: "collapse",
          my: 2.5,
          fontSize: { xs: "0.95rem", md: "1.05rem" },
        },
        "& th, & td": {
          border: "1px solid",
          borderColor: "divider",
          px: 1.5,
          py: 1,
          textAlign: "left",
          verticalAlign: "top",
        },
        "& th": { fontWeight: 700, bgcolor: "action.hover" },
        "& mark": { bgcolor: "warning.light", px: 0.25 },
        "& img": { borderRadius: 1.5 },
        "&::after": { content: '""', display: "table", clear: "both" },
        "& a:focus-visible": {
          outline: "3px solid",
          outlineColor: "primary.main",
          outlineOffset: 3,
        },
      }}
    >
      {render(nodes)}
    </Box>
  );
}
