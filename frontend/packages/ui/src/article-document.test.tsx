import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ARTICLE_MAX_ELEMENTS,
  ArticleDocumentView,
  normalizeArticleDocument,
} from "./article-document";

describe("versioned article rendering", () => {
  it("preserves supported semantics and safely renders hostile text and links", () => {
    const html =
      '<h2>Report</h2><h3>Section</h3><h4>Detail</h4><p><strong>Bold</strong> <em>Emphasis</em></p><ul><li>First</li></ul><ol><li>Second</li></ol><blockquote>Quote</blockquote><script>window.attack=1</script><p onclick="attack()"><a href="javascript:attack()">Unsafe</a><a href="https://uog.edu.et">University</a>&lt;img onerror=attack()&gt;</p>';
    const { container } = render(
      <ArticleDocumentView document={{ schema_version: 1, html }} />,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Report" }),
    ).toBeTruthy();
    expect(
      container.querySelectorAll("ul,ol,blockquote,strong,em"),
    ).toHaveLength(5);
    expect(container.querySelector("script,[onclick],img")).toBeNull();
    expect(screen.queryByRole("link", { name: "Unsafe" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "University" }).getAttribute("href"),
    ).toBe("https://uog.edu.et/");
    expect(container.textContent).toContain("<img onerror=attack()>");
  });
  it("rejects unknown versions and unbounded documents without executing content", () => {
    expect(() =>
      normalizeArticleDocument({ schema_version: 2, html: "text" }),
    ).toThrow();
    expect(() =>
      normalizeArticleDocument({ schema_version: 1, html: "x".repeat(200001) }),
    ).toThrow();
    expect(ARTICLE_MAX_ELEMENTS).toBe(2000);
    expect(() =>
      normalizeArticleDocument({
        schema_version: 1,
        html: `<p>${Array.from({ length: ARTICLE_MAX_ELEMENTS + 1 }, () => "<br>").join("")}</p>`,
      }),
    ).toThrow(/too many elements/i);
    render(
      <ArticleDocumentView
        document={{ schema_version: 2, html: "<script>alert(1)</script>" }}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("unavailable");
  });
});


it("persists asset identities without supplied URLs and renders scoped delivery with a stable fallback", () => {
  const asset = "11111111-1111-4111-8111-111111111111";
  const node = "22222222-2222-4222-8222-222222222222";
  const html = `<p>Campus</p><img data-asset-id="${asset}" data-node-id="${node}" alt="Campus gardens" src="https://hostile.test/private" onerror="attack()">`;
  const document = normalizeArticleDocument({schema_version:1,html});
  expect(document.html).not.toContain("src=");
  expect(document.html).not.toContain("onerror");
  const {unmount} = render(<ArticleDocumentView document={document} siteId={11} mediaBase="/admin/sites/11/media" />);
  const image = screen.getByRole("img",{name:"Campus gardens"});
  expect(image.getAttribute("src")).toBe(`/admin/sites/11/media/${asset}/image?variant=display`);
  fireEvent.error(image);
  expect(screen.getByRole("status").textContent).toContain("Campus gardens");
  unmount();
  render(<ArticleDocumentView document={document} siteId={11} />);
  expect(screen.getByRole("img").getAttribute("src")).toBe(`/api/v1/site-context/media/${asset}/?variant=display`);
  expect(() => normalizeArticleDocument({schema_version:1,html:html+html})).toThrow(/unique/);
});
