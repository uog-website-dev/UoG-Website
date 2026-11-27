import { describe, expect, it } from "vitest";

import {
  htmlFromPageBlocks,
  richTextBlocksFromHtml,
  richTextIsEmpty,
  splitPageBlocksForEditor,
} from "./page-rich-content";

const UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("richTextBlocksFromHtml", () => {
  it("maps headings, paragraphs, lists and inline formatting to Page blocks", () => {
    const html = [
      "<h2>Welcome</h2>",
      "<p>Apply <strong>now</strong> at <a href=\"/apply\">our office</a>.</p>",
      "<ul><li>Transcripts</li><li>Fees</li></ul>",
      "<ol><li>Register</li></ol>",
      "<blockquote>Ask us anything.</blockquote>",
    ].join("");
    expect(richTextBlocksFromHtml(html, 11)).toEqual([
      { type: "heading", level: 2, text: "Welcome" },
      { type: "paragraph", html: "<p>Apply <strong>now</strong> at <a href=\"/apply\">our office</a>.</p>" },
      { type: "list", style: "unordered", items: ["Transcripts", "Fees"] },
      { type: "list", style: "ordered", items: ["Register"] },
      { type: "paragraph", html: "<blockquote>Ask us anything.</blockquote>" },
    ]);
  });

  it("turns inserted asset images into image blocks for this Site", () => {
    const html = `<p>Before</p><img data-asset-id="${UUID}" data-node-id="${UUID}" alt="Campus" style="width: 50%; float: left; margin: 0 1rem 1rem 0; display: block">`;
    expect(richTextBlocksFromHtml(html, 11)).toEqual([
      { type: "paragraph", html: "<p>Before</p>" },
      {
        type: "image",
        ref: `sites/11/assets/${UUID}`,
        alt: "Campus",
        style: "width: 50%; float: left; margin: 0 1rem 1rem 0; display: block",
      },
    ]);
  });

  it("keeps tables as paragraph HTML for public rendering", () => {
    const html = "<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>";
    expect(richTextBlocksFromHtml(html, 11)).toEqual([
      { type: "paragraph", html },
    ]);
  });

  it("keeps bare text, drops empty nodes and clamps heading depth", () => {
    expect(richTextBlocksFromHtml("<h1>Title</h1><p> </p><span>Loose</span>", 11)).toEqual([
      { type: "heading", level: 2, text: "Title" },
      { type: "paragraph", html: "<p><span>Loose</span></p>" },
    ]);
    expect(richTextBlocksFromHtml("", 11)).toEqual([]);
  });
});

describe("richTextIsEmpty", () => {
  it("treats markup-only content as empty", () => {
    expect(richTextIsEmpty("")).toBe(true);
    expect(richTextIsEmpty("<p><br></p>")).toBe(true);
    expect(richTextIsEmpty("<p>Hello</p>")).toBe(false);
  });
});

describe("htmlFromPageBlocks and splitPageBlocksForEditor", () => {
  it("rebuilds editor HTML from leading rich-text blocks", () => {
    const html = htmlFromPageBlocks(
      [
        { type: "heading", level: 2, text: "Welcome" },
        { type: "paragraph", html: "<p>Hello <strong>world</strong></p>" },
        { type: "list", style: "unordered", items: ["One", "Two"] },
        { type: "image", ref: `sites/11/assets/${UUID}`, alt: "Campus" },
      ],
      11,
    );
    expect(html).toContain("<h2>Welcome</h2>");
    expect(html).toContain("<p>Hello <strong>world</strong></p>");
    expect(html).toContain("<ul><li>One</li><li>Two</li></ul>");
    expect(html).toContain(`data-asset-id="${UUID}"`);
    expect(html).toContain('alt="Campus"');
  });

  it("splits leading rich-text from structured extras", () => {
    const { html, structured } = splitPageBlocksForEditor(
      [
        { type: "heading", level: 2, text: "About" },
        { type: "paragraph", html: "<p>Body</p>" },
        { type: "button", label: "Learn more", href: "/apply" },
        { type: "paragraph", html: "<p>After button stays structured</p>" },
      ],
      11,
    );
    expect(html).toBe("<h2>About</h2><p>Body</p>");
    expect(structured).toEqual([
      { type: "button", label: "Learn more", href: "/apply" },
      { type: "paragraph", html: "<p>After button stays structured</p>" },
    ]);
  });
});
