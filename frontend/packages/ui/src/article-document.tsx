"use client";

import { createElement, useState } from "react";
import type { ReactNode } from "react";
import { parseFragment } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import Box from "@mui/material/Box";
import { safeMenuHref } from "./site-navigation";

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
  "ul",
  "ol",
  "li",
  "blockquote",
  "a",
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

export function articleHref(value: string): string | null {
  if (/^mailto:[a-z0-9.!%+_-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value))
    return value;
  if (value.startsWith("#")) return null;
  return safeMenuHref(value);
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
        const attr = (name: string) => node.attrs.find(a => a.name === name)?.value ?? "";
        const assetId = attr("data-asset-id");
        if (!assetId) return [];
        const nodeId = attr("data-node-id");
        const alt = attr("alt").trim();
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuid.test(assetId) || !uuid.test(nodeId) || !alt || alt.length > 1000)
          throw new Error("Images require an asset, unique placement ID and alternative text.");
        if (imageNodes.has(nodeId.toLowerCase())) throw new Error("Image placement identifiers must be unique.");
        imageNodes.add(nodeId.toLowerCase());
        return [{tag:"img", assetId, nodeId, alt}];
      }
      const children = visit(node.childNodes, depth + 1);
      const tag =
        ({ b: "strong", i: "em", div: "p" } as Record<string, string>)[
          node.tagName
        ] ?? node.tagName;
      if (!allowed.has(tag)) return children;
      const href =
        tag === "a"
          ? articleHref(node.attrs.find((a) => a.name === "href")?.value ?? "")
          : null;
      if (tag === "a" && !href) return children;
      return [
        {
          tag,
          children,
          ...(href
            ? { href, title: node.attrs.find((a) => a.name === "title")?.value }
            : {}),
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
      if (node.tag === "img") return `<img data-asset-id="${escape(node.assetId!)}" data-node-id="${escape(node.nodeId!)}" alt="${escape(node.alt!)}">`;
      const attributes = node.href
        ? ` href="${escape(node.href)}"${node.title ? ` title="${escape(node.title)}"` : ""} rel="noopener noreferrer"`
        : "";
      return `<${node.tag}${attributes}>${serialize(node.children ?? [])}</${node.tag}>`;
    })
    .join("");
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
export function ArticleAssetImage({assetId, alt, siteId, mediaBase}: {assetId:string; alt:string; siteId:number; mediaBase?:string}) {
  const [failed, setFailed] = useState(false);
  const src = mediaBase ? `${mediaBase}/${assetId}/image?variant=display` : `/api/v1/site-context/media/${assetId}/?variant=display`;
  if (failed) return <Box role="status">Image unavailable. {alt}</Box>;
  return <Box component="img" src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} sx={{maxWidth:"100%",height:"auto",display:"block",my:2}} />;
}

export function ArticleDocumentView({ document, siteId, mediaBase }: { document: unknown; siteId?:number; mediaBase?:string }) {
  let nodes: ArticleNode[];
  try {
    nodes = nodesFrom(normalizeArticleDocument(document).html);
  } catch {
    return <Box role="status">This article content is unavailable.</Box>;
  }
  const render = (values: ArticleNode[]): ReactNode =>
    values.map((node, index) =>
      node.tag === "text"
        ? node.text
        : node.tag === "img"
        ? siteId ? <ArticleAssetImage key={`${node.nodeId}:${node.assetId}`} assetId={node.assetId!} alt={node.alt!} siteId={siteId} mediaBase={mediaBase} /> : <Box key={index}>Image unavailable. {node.alt}</Box>
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
            },
            node.tag === "br" ? undefined : render(node.children ?? []),
          ),
    );
  return (
    <Box
      data-article-version="1"
      sx={{
        maxWidth: "75ch",
        overflowWrap: "anywhere",
        lineHeight: 1.8,
        "& h2": { fontSize: "clamp(1.5rem,3vw,2rem)" },
        "& h3": { fontSize: "1.4rem" },
        "& h4": { fontSize: "1.2rem" },
        "& blockquote": {
          borderLeft: "4px solid",
          borderColor: "primary.main",
          pl: 3,
          ml: 0,
          color: "text.secondary",
        },
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
