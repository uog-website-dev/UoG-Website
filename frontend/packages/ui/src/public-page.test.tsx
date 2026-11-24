import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { pageFromResponse, paragraphParts, PublicPageView } from "./public-page";
import { VisualLayoutView } from "./visual-layout";

const published = {
  status: "PUBLISHED",
  title: "Admissions",
  path: "/admissions",
  site: 11,
  blocks: [
    { type: "heading", level: 2, text: "Apply" },
    {
      type: "paragraph",
      html: "<p>Hello<script>alert(1)</script> <a href=\"javascript:alert(2)\">Bad</a> <a href=\"/about\">About</a></p>",
    },
    { type: "button", label: "Blocked", href: "javascript:alert(3)" },
    { type: "button", label: "Portal", href: "https://portal.example.edu/apply" },
  ],
  otherSite: { title: "Hospital" },
};

const image = "00000000-0000-4000-8000-000000000001";

/** A visual Page whose only layout widget is one hero. */
function visualPage(settings?: { show_title?: boolean; chrome?: "global" | "none" }, headingLevel?: 1 | 2, isHomepage = false) {
  return pageFromResponse(200, {
    ...published,
    is_homepage: isHomepage,
    blocks: [],
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
                    props: {
                      asset_id: image,
                      alt: "Campus",
                      title: "Welcome",
                      ...(headingLevel === undefined ? {} : { heading_level: headingLevel }),
                    },
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

describe("pageFromResponse", () => {
  it("reads one published page and ignores a disabled module", () => {
    const page = pageFromResponse(200, published);
    expect(page?.title).toBe("Admissions");
    expect(page?.path).toBe("/admissions");
    expect(pageFromResponse(404, { error: { code: "not_found" } })).toBeNull();
    expect(pageFromResponse(200, { ...published, status: "DRAFT", title: "Secret" })).toBeNull();
  });
});

describe("paragraphParts", () => {
  it("drops script and javascript targets", () => {
    const html = published.blocks[1]?.html ?? "";
    const parts = paragraphParts(html);
    expect(parts.some((part) => part.type === "link" && part.label === "Bad")).toBe(false);
    expect(parts.find((part) => part.type === "link" && part.label === "About")).toMatchObject({
      href: "/about",
    });
    expect(JSON.stringify(parts)).not.toContain("<script");
    expect(JSON.stringify(parts)).not.toContain("javascript:");
  });
});

describe("PublicPageView", () => {
  it("marks the visual homepage so its first section can sit directly below the Site header", () => {
    const { container } = render(<PublicPageView page={visualPage(undefined, undefined, true)} />);
    expect(container.querySelector('[data-page-homepage="true"]')).toBeTruthy();
  });

  it("keeps the global chrome unless the Page explicitly opts out", () => {
    const { container } = render(<PublicPageView page={visualPage()} />);
    expect(container.querySelector("[data-page-chrome]")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Page navigation" })).toBeNull();
  });
  it("renders a chrome-free Page with its own navigation affordance", () => {
    const { container } = render(<PublicPageView page={visualPage({ chrome: "none" })} />);
    expect(container.querySelector('[data-page-chrome="none"]')).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Page navigation" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Site home/ }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
  });
  it("still renders legacy Site chrome widgets inside a published layout", () => {
    const layout = {
      schema_version: 1 as const,
      rows: [{
        id: "row", type: "section" as const, ratios: [100] as [100],
        columns: [{ id: "column", type: "column" as const, children: [
          { id: "legacy-logo", type: "site_logo" as const, props: {} },
          { id: "legacy-title", type: "site_title" as const, props: {} },
          { id: "legacy-menu", type: "menu" as const, props: { menu_code: "header" } },
        ] }],
      }],
    };
    const { container } = render(<VisualLayoutView layout={layout} siteId={null} pageTitle="Admissions" />);
    expect(container.querySelectorAll("[data-widget-type]").length).toBe(3);
    expect(container.querySelector('[data-widget-type="site_title"]')?.textContent).toContain("placeholder");
  });
  it("renders the published page and does not mount unsafe markup", () => {
    const { container } = render(<PublicPageView page={pageFromResponse(200, published)} />);
    expect(screen.getByRole("heading", { level: 1, name: "Admissions" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "About" }).getAttribute("href")).toBe("/about");
    expect(screen.getByRole("link", { name: "Portal" }).getAttribute("href")).toBe("https://portal.example.edu/apply");
    expect(screen.queryByRole("link", { name: "Bad" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Blocked" })).toBeNull();
    expect(screen.getByText("Blocked").tagName).not.toBe("A");
    expect(container.querySelector("script")).toBeNull();
    expect(container.innerHTML).not.toContain("javascript:");
    expect(screen.queryByText("Hospital")).toBeNull();
  });

  it("lets a keyboard user reach a safe link", async () => {
    const user = userEvent.setup();
    render(<PublicPageView page={pageFromResponse(200, published)} />);
    const about = screen.getByRole("link", { name: "About" });
    await user.tab();
    expect(document.activeElement === about || about.matches(":focus-visible, :focus")).toBe(true);
  });

  it("states that a missing or unpublished page is not shown", () => {
    render(<PublicPageView page={null} />);
    expect(screen.getByRole("status").textContent).toMatch(/no published page/i);
  });

  it("shows the automatic page title as the only H1 when no hero supplies one", () => {
    const { container } = render(<PublicPageView page={visualPage(undefined)} />);
    expect(screen.getByRole("heading", { level: 1, name: "Admissions" })).toBeTruthy();
    expect(getComputedStyle(screen.getByRole("heading", { level: 1, name: "Admissions" })).position).not.toBe("absolute");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: "Welcome" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "Admissions" })).toBeTruthy();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });

  it("clips the page title only when one hero supplies the visible H1", () => {
    render(<PublicPageView page={visualPage({ show_title: false }, 1)} />);
    const title = document.getElementById("public-page-title");
    expect(title?.tagName).toBe("SPAN");
    expect(title?.textContent).toBe("Admissions");
    expect(getComputedStyle(title!).position).toBe("absolute");
    expect(screen.getByRole("heading", { level: 1, name: "Welcome" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("article", { name: "Admissions" })).toBeTruthy();
  });

  it("demotes a hero H1 when the page title is also visible", () => {
    render(<PublicPageView page={visualPage({ show_title: true }, 1)} />);
    expect(getComputedStyle(screen.getByRole("heading", { level: 1, name: "Admissions" })).position).not.toBe("absolute");
    expect(screen.getByRole("heading", { level: 2, name: "Welcome" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("restores a visible page title when a hidden title has no H1", () => {
    render(<PublicPageView page={visualPage({ show_title: false })} />);
    expect(getComputedStyle(screen.getByRole("heading", { level: 1, name: "Admissions" })).position).not.toBe("absolute");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});


describe("Published media derivatives", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  it("uses Host-scoped responsive variants and falls back to alt text on failure", () => {
    const { container } = render(<PublicPageView page={pageFromResponse(200, { ...published, blocks: [{ type: "image", ref: `sites/11/assets/${id}`, alt: "Campus image" }] })} />);
    const image=screen.getByRole("img",{name:"Campus image"});
    expect(image.getAttribute("src")).toBe(`/api/v1/site-context/media/${id}/?variant=display`);
    expect(container.querySelector("source")?.getAttribute("srcset")).toBe(`/api/v1/site-context/media/${id}/?variant=thumbnail`);
    fireEvent.error(image);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("Campus image")).toBeTruthy();
  });
  it("does not construct a public URL for a foreign Site reference", () => {
    render(<PublicPageView page={pageFromResponse(200, { ...published, blocks: [{ type: "image", ref: `sites/22/assets/${id}`, alt: "Unavailable image" }] })} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("Unavailable image")).toBeTruthy();
  });
  it("resets a failed image when the asset or Site changes", () => {
    const view=render(<PublicPageView page={pageFromResponse(200,{...published,blocks:[{type:"image",ref:`sites/11/assets/${id}`,alt:"First image"}]})} />);
    fireEvent.error(screen.getByRole("img",{name:"First image"}));
    const next="00000000-0000-4000-8000-000000000002";
    view.rerender(<PublicPageView page={pageFromResponse(200,{...published,site:22,blocks:[{type:"image",ref:`sites/22/assets/${next}`,alt:"Second Site image"}]})} />);
    expect(screen.getByRole("img",{name:"Second Site image"}).getAttribute("src")).toBe(`/api/v1/site-context/media/${next}/?variant=display`);
  });

});

 it("renders nested Slider and Gallery uses independently for the same asset", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const item = { id: "one", asset_id: id, alt: "Shared campus" };
    const gallery = { type: "gallery", id: "gallery", images: [item] };
    const slider = { type: "slider", id: "slider", slides: [item, { ...item, id: "two", alt: "Second slide" }] };
    const view = render(<PublicPageView page={pageFromResponse(200, { ...published, blocks: [{ type: "section", children: [{ type: "section", children: [slider, gallery] }] }] })} />);
    expect(screen.getAllByRole("img", { name: "Shared campus" })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(screen.getByRole("img", { name: "Second slide" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Shared campus" })).toBeTruthy();
    view.rerender(<PublicPageView page={pageFromResponse(200, { ...published, blocks: [gallery] })} />);
    expect(screen.getByRole("img", { name: "Shared campus" }).getAttribute("src")).toContain(id);
    expect(screen.queryByRole("region", { name: "Image slider" })).toBeNull();
  });

it("renders historical compact UUID references through the canonical public route", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  render(<PublicPageView page={pageFromResponse(200, { ...published, blocks: [{ type: "image", ref: `sites/011/assets/${id.replaceAll("-", "")}`, alt: "Historical photo" }] })} />);
  expect(screen.getByRole("img", { name: "Historical photo" }).getAttribute("src")).toBe(`/api/v1/site-context/media/${id}/?variant=display`);
});
