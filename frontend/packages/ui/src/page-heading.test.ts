import { describe, expect, it } from "vitest";
import type { VisualLayout } from "@uog/types";
import { countLayoutH1, resolvePageHeading } from "./page-heading";

const image = "00000000-0000-4000-8000-000000000001";

function hero(id: string, heading_level?: 1 | 2 | 3 | 4) {
  return {
    id,
    type: "hero_image" as const,
    props: {
      asset_id: image,
      alt: "Campus",
      title: `Hero ${id}`,
      ...(heading_level === undefined ? {} : { heading_level }),
    },
  };
}

function layout(
  children: VisualLayout["rows"][number]["columns"][number]["children"],
  settings?: VisualLayout["settings"],
): VisualLayout {
  return {
    schema_version: 1,
    ...(settings === undefined ? {} : { settings }),
    rows: [
      {
        id: "row",
        type: "section",
        ratios: [100],
        columns: [{ id: "column", type: "column", children }],
      },
    ],
  };
}

describe("resolvePageHeading", () => {
  it("keeps the Page title as the only H1 by default", () => {
    const resolved = resolvePageHeading(layout([hero("hero")]));
    expect(resolved).toMatchObject({
      ok: true,
      titleVisible: true,
      demoteLayoutH1: true,
      layoutH1Count: 0,
      message: "",
    });
  });

  it("lets a hidden Page title hand the H1 to exactly one hero", () => {
    const resolved = resolvePageHeading(layout([hero("hero", 1)], { show_title: false }));
    expect(resolved).toMatchObject({
      ok: true,
      titleVisible: false,
      demoteLayoutH1: false,
      layoutH1Count: 1,
    });
  });

  it("blocks a visible Page title when a hero also requests H1", () => {
    const resolved = resolvePageHeading(layout([hero("hero", 1)], { show_title: true }));
    expect(resolved.ok).toBe(false);
    expect(resolved.titleVisible).toBe(true);
    expect(resolved.demoteLayoutH1).toBe(true);
    expect(resolved.message).toMatch(/Page title is shown/i);
  });

  it("falls back to a visible Page title when a hidden title has no H1", () => {
    const resolved = resolvePageHeading(layout([hero("hero")], { show_title: false }));
    expect(resolved.ok).toBe(false);
    expect(resolved.titleVisible).toBe(true);
    expect(resolved.demoteLayoutH1).toBe(true);
    expect(resolved.message).toMatch(/Page title is hidden/i);
  });

  it("blocks a hidden Page title with two hero H1s", () => {
    const resolved = resolvePageHeading(
      layout([hero("first", 1), hero("second", 1)], { show_title: false }),
    );
    expect(resolved.ok).toBe(false);
    expect(resolved.layoutH1Count).toBe(2);
    expect(resolved.titleVisible).toBe(true);
    expect(resolved.message).toMatch(/Only one visible H1/i);
  });

  it("counts a carousel H1 once because one slide is visible", () => {
    const carousel = {
      id: "carousel",
      type: "layout_slider" as const,
      props: {
        items: [
          { id: "slide-a", children: [hero("hero-a", 1)] },
          { id: "slide-b", children: [hero("hero-b", 1)] },
        ],
      },
    };
    const resolved = resolvePageHeading(layout([carousel], { show_title: false }));
    expect(resolved.layoutH1Count).toBe(1);
    expect(resolved.ok).toBe(true);
  });

  it("counts every masonry H1 because all children render", () => {
    const masonry = {
      id: "masonry",
      type: "simple_masonry" as const,
      props: {
        items: [
          { id: "item-a", children: [hero("hero-a", 1)] },
          { id: "item-b", children: [hero("hero-b", 1)] },
        ],
      },
    };
    expect(countLayoutH1(layout([masonry]))).toBe(2);
    expect(resolvePageHeading(layout([masonry], { show_title: false })).ok).toBe(false);
  });

  it("ignores headings that cannot be H1", () => {
    const headline = { id: "headline", type: "headline" as const, props: { text: "Section", level: 2 as const } };
    const pageTitle = { id: "page-title", type: "page_title" as const, props: {} };
    const resolved = resolvePageHeading(layout([headline, pageTitle]));
    expect(resolved.layoutH1Count).toBe(0);
    expect(resolved.ok).toBe(true);
  });
});
