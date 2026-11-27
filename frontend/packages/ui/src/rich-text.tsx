"use client";

/**
 * Safe rendering for Page paragraph blocks.
 *
 * The CMS sanitizes paragraph HTML on write (backend/apps/cms/blocks.py), but
 * builder and draft previews render local HTML before that round trip, so this
 * renderer is the second gate. Its element set mirrors the sanitizer's
 * `_RICH_TEXT_TAGS`: the formatting the editor can produce becomes markup,
 * links must pass the article href policy, and every other element is
 * unwrapped to its text.
 */
import { Fragment, createElement } from "react";
import type { CSSProperties, ReactNode } from "react";
import { parseFragment } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";

import { articleHref } from "./article-document";
import { sanitizeInlineStyle } from "./article-style";

type HtmlNode = DefaultTreeAdapterMap["childNode"];
type HtmlElement = DefaultTreeAdapterMap["element"];

/** Removed with their content; every other unknown element is unwrapped. */
const removedTags = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "svg",
  "math",
  "template",
  "img",
]);

/** Inline elements the sanitizer keeps, mapped to their React tag. */
const inlineTags: Record<string, string> = {
  strong: "strong",
  b: "strong",
  em: "em",
  i: "em",
  u: "u",
  s: "s",
  mark: "mark",
  span: "span",
};

/** Elements that stand alone rather than inside the implicit paragraph. */
const blockTags = new Set(["p", "div", "blockquote", "ul", "ol", "table"]);

const styleTags = new Set(["span", "mark", "p", "table", "th", "td", "tr"]);

// Text fills the Page column, whose width is resolved once by PublicPageView.
const paragraphSx = { overflowWrap: "anywhere" } as const;
const listSx = { pl: 3, overflowWrap: "anywhere" } as const;
const quoteSx = {
  borderLeft: "4px solid",
  borderColor: "primary.main",
  pl: 3,
  my: 2,
  color: "text.secondary",
  bgcolor: "action.hover",
  borderRadius: 1,
  overflowWrap: "anywhere",
  "& p": { fontStyle: "italic" },
} as const;
const tableSx = {
  width: "100%",
  borderCollapse: "collapse",
  my: 2,
  overflowWrap: "anywhere",
  "& th, & td": {
    border: "1px solid",
    borderColor: "divider",
    px: 1.5,
    py: 1,
    textAlign: "left",
    verticalAlign: "top",
  },
  "& th": { fontWeight: 700, bgcolor: "action.hover" },
} as const;

function attribute(node: HtmlElement, name: string): string {
  return node.attrs.find((entry) => entry.name === name)?.value ?? "";
}

function cssFromStyle(style: string): CSSProperties | undefined {
  if (!style) return undefined;
  return Object.fromEntries(
    style
      .split(";")
      .filter(Boolean)
      .map((part) => {
        const [prop, ...rest] = part.split(":");
        const key = (prop ?? "").trim().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
        return [key, rest.join(":").trim()];
      })
      .filter(([key, value]) => key && value),
  ) as CSSProperties;
}

function renderNodes(nodes: HtmlNode[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}:${index}`;
    if (node.nodeName === "#text") {
      return (node as DefaultTreeAdapterMap["textNode"]).value;
    }
    if (!("tagName" in node)) return null;
    const tag = node.tagName.toLowerCase();
    if (removedTags.has(tag)) return null;
    if (tag === "br") return <br key={key} />;
    const children = renderNodes(node.childNodes, key);
    const style = styleTags.has(tag) ? cssFromStyle(sanitizeInlineStyle(attribute(node, "style"))) : undefined;
    if (tag === "a") {
      const href = articleHref(attribute(node, "href"));
      if (!href) return <Fragment key={key}>{children}</Fragment>;
      return (
        <Link key={key} href={href} rel="noopener noreferrer" sx={{ overflowWrap: "anywhere" }}>
          {children}
        </Link>
      );
    }
    if (inlineTags[tag]) return createElement(inlineTags[tag]!, { key, style }, children);
    if (tag === "p" || tag === "div") {
      return (
        <Typography key={key} component="p" sx={paragraphSx} style={style}>
          {children}
        </Typography>
      );
    }
    if (tag === "blockquote") {
      return (
        <Box key={key} component="blockquote" sx={quoteSx}>
          {children}
        </Box>
      );
    }
    if (tag === "ul" || tag === "ol") {
      return (
        <Box key={key} component={tag} sx={listSx}>
          {children}
        </Box>
      );
    }
    if (tag === "li") {
      return (
        <Typography key={key} component="li">
          {children}
        </Typography>
      );
    }
    if (tag === "table") {
      return (
        <Box key={key} component="table" sx={tableSx} style={style}>
          {children}
        </Box>
      );
    }
    if (tag === "thead" || tag === "tbody" || tag === "tr") {
      return createElement(tag, { key, style }, children);
    }
    if (tag === "th" || tag === "td") {
      const colspan = attribute(node, "colspan");
      const rowspan = attribute(node, "rowspan");
      return createElement(
        tag,
        {
          key,
          style,
          ...(colspan && /^[1-9]\d?$/.test(colspan) ? { colSpan: Number(colspan) } : {}),
          ...(rowspan && /^[1-9]\d?$/.test(rowspan) ? { rowSpan: Number(rowspan) } : {}),
        },
        children,
      );
    }
    // Unknown markup keeps its reading text but never its element or attributes.
    return <Fragment key={key}>{children}</Fragment>;
  });
}

function parse(html: string): HtmlNode[] {
  try {
    return parseFragment(html).childNodes;
  } catch {
    return [];
  }
}

function textContent(nodes: HtmlNode[]): string {
  return nodes
    .map((node) =>
      node.nodeName === "#text"
        ? (node as DefaultTreeAdapterMap["textNode"]).value
        : "childNodes" in node
          ? textContent(node.childNodes)
          : "",
    )
    .join("");
}

/**
 * Render one paragraph block's HTML. Formatting the editor offers — bold,
 * italic, color, highlight, shadow, tables, quotes, lists and links — survives
 * to the public Page; a fragment without block markup is wrapped in a
 * paragraph of its own.
 */
export function RichText({ html }: { html: string }): ReactNode {
  const nodes = parse(html);
  // Invisible text (empty tags, `&nbsp;`, bare line breaks) is not a block.
  if (!textContent(nodes).replace(/\u00a0/g, " ").trim()) return null;
  const rendered = renderNodes(nodes, "rich");
  const hasBlock = nodes.some(
    (node) => "tagName" in node && blockTags.has(node.tagName.toLowerCase()),
  );
  if (!hasBlock) {
    return (
      <Typography component="p" sx={paragraphSx}>
        {rendered}
      </Typography>
    );
  }
  return (
    <Box sx={{ "&::after": { content: '""', display: "table", clear: "both" } }}>
      {rendered}
    </Box>
  );
}
