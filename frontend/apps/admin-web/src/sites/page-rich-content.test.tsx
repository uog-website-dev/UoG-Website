import { describe, expect, it } from "vitest";

import { richTextBlocksFromHtml, richTextIsEmpty } from "./page-rich-content";

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
    const html = `<p>Before</p><img data-asset-id="${UUID}" data-node-id="${UUID}" alt="Campus">`;
    expect(richTextBlocksFromHtml(html, 11)).toEqual([
      { type: "paragraph", html: "<p>Before</p>" },
      { type: "image", ref: `sites/11/assets/${UUID}`, alt: "Campus" },
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
