import { describe, expect, it } from "vitest";

import { imageLayoutStyle, sanitizeInlineStyle } from "./article-style";

describe("sanitizeInlineStyle", () => {
  it("keeps text color, highlight and shadow values from the editor", () => {
    expect(sanitizeInlineStyle("color: #b42318; background-color: #fef3c7")).toBe(
      "color: #b42318; background-color: #fef3c7",
    );
    expect(sanitizeInlineStyle("text-shadow: 0 1px 2px rgba(0,0,0,0.35)")).toBe(
      "text-shadow: 0 1px 2px rgba(0,0,0,0.35)",
    );
    expect(sanitizeInlineStyle("text-shadow: 0 0 8px rgba(201,162,39,0.75)")).toBe(
      "text-shadow: 0 0 8px rgba(201,162,39,0.75)",
    );
  });

  it("drops unsafe declarations", () => {
    expect(sanitizeInlineStyle("color: red; background: url(javascript:alert(1))")).toBe("color: red");
    expect(sanitizeInlineStyle("width: expression(alert(1))")).toBe("");
  });
});

describe("imageLayoutStyle", () => {
  it("encodes alignment and width for inserted images", () => {
    expect(imageLayoutStyle("left", 40)).toContain("float: left");
    expect(imageLayoutStyle("left", 40)).toContain("width: 40%");
    expect(imageLayoutStyle("full", 40)).toContain("width: 100%");
    expect(imageLayoutStyle("center", 75)).toContain("margin: 1rem auto");
  });
});
