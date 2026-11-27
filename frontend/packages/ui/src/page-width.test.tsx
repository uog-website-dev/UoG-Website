import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { pageFromResponse, PublicPageView } from "./public-page";

const image = "00000000-0000-4000-8000-000000000001";

/** A published visual Page with one hero and optional Page settings. */
function visualPage(settings?: Record<string, unknown>) {
  return pageFromResponse(200, {
    id: "page",
    site: 11,
    status: "PUBLISHED",
    title: "Admissions",
    path: "/admissions",
    blocks: [],
    seo: {},
    metadata: {
      visual_layout: {
        schema_version: 1,
        ...(settings === undefined ? {} : { settings }),
        rows: [
          {
            id: "row",
            type: "section",
            ratios: [100],
            columns: [
              {
                id: "column",
                type: "column",
                children: [
                  {
                    id: "hero",
                    type: "hero_image",
                    props: { asset_id: image, alt: "Campus", title: "Welcome" },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  });
}

const pageShell = () => document.querySelector('[data-page-layout="FULL_WIDTH"]') as HTMLElement;
const article = () => document.querySelector("article") as HTMLElement;
/** The banner now spans the full shell; the safe gutter is applied to the content row. */
const contentRow = () => article().parentElement as HTMLElement;

describe("PublicPageView page width", () => {
  it("defaults to Wide with a visible safe gutter", () => {
    render(<PublicPageView page={visualPage()} />);
    expect(pageShell().getAttribute("data-page-width")).toBe("wide");
    expect(pageShell().getAttribute("data-page-bleed")).toBeNull();
    expect(pageShell().getAttribute("data-page-gutter")).toBe("24px");
    expect(getComputedStyle(contentRow()).paddingLeft).toBe("24px");
    expect(getComputedStyle(contentRow()).paddingRight).toBe("24px");
    expect(getComputedStyle(article()).maxWidth).toBe("1120px");
  });

  it("keeps the Reading cap and the same gutter", () => {
    render(<PublicPageView page={visualPage({ content_width: "reading" })} />);
    expect(pageShell().getAttribute("data-page-width")).toBe("reading");
    expect(getComputedStyle(contentRow()).paddingLeft).toBe("24px");
    expect(getComputedStyle(article()).maxWidth).toBe("880px");
  });

  it("does not bleed for the legacy full width token", () => {
    render(<PublicPageView page={visualPage({ content_width: "full" })} />);
    expect(pageShell().getAttribute("data-page-bleed")).toBeNull();
    expect(pageShell().getAttribute("data-page-gutter")).toBe("24px");
    expect(getComputedStyle(contentRow()).paddingLeft).toBe("24px");
    expect(getComputedStyle(article()).maxWidth).toBe("100%");
  });

  it("falls back to Wide for an unknown stored width instead of failing the Page", () => {
    render(<PublicPageView page={visualPage({ content_width: "huge" })} />);
    expect(pageShell().getAttribute("data-page-width")).toBe("wide");
    expect(pageShell().getAttribute("data-page-gutter")).toBe("24px");
    expect(getComputedStyle(article()).maxWidth).toBe("1120px");
  });

  it("ignores a non-boolean bleed value", () => {
    render(<PublicPageView page={visualPage({ content_width: "wide", bleed: "true" })} />);
    expect(pageShell().getAttribute("data-page-bleed")).toBeNull();
    expect(pageShell().getAttribute("data-page-gutter")).toBe("24px");
  });

  it("bleeds only when the Page opts in explicitly", () => {
    render(<PublicPageView page={visualPage({ content_width: "wide", bleed: true })} />);
    expect(pageShell().getAttribute("data-page-bleed")).toBe("true");
    expect(pageShell().getAttribute("data-page-gutter")).toBe("0px");
    expect(getComputedStyle(contentRow()).paddingLeft).toBe("0px");
    expect(getComputedStyle(article()).maxWidth).toBe("100%");
  });
});
