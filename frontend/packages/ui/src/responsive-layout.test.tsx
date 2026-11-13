import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  LAYOUT_BREAKPOINT_WIDTHS,
  LAYOUT_STACK_DEFAULT_MIN_WIDTH,
  breakpointAtWidth,
  precedenceMatrix,
  resetResponsiveProperty,
  resolveSectionPresentation,
  resolveWidgetPresentation,
  setResponsiveProperty,
  validateVisualLayout,
} from "@uog/types";
import type { VisualLayout } from "@uog/types";
import fixtures from "../../types/src/layout/fixtures.json";
import { PublicPageView, pageFromResponse } from "./public-page";
import { VisualLayoutView } from "./visual-layout";

const responsiveFixture = fixtures.find((fixture) => fixture.name === "responsive-spacing-stack")!.layout as VisualLayout;
const legacyFixture = fixtures.find((fixture) => fixture.name === "three-column-slider")!.layout as VisualLayout;

function pageDoc(layout: VisualLayout) {
  return pageFromResponse(200, { title: "Responsive", site: 11, blocks: [], metadata: { visual_layout: layout } });
}

describe("breakpoint precedence matrix", () => {
  it("classifies preview widths and boundaries", () => {
    expect(breakpointAtWidth(LAYOUT_BREAKPOINT_WIDTHS.mobile)).toBe("mobile");
    expect(breakpointAtWidth(767)).toBe("mobile");
    expect(breakpointAtWidth(LAYOUT_BREAKPOINT_WIDTHS.tablet)).toBe("tablet");
    expect(breakpointAtWidth(1279)).toBe("tablet");
    expect(breakpointAtWidth(LAYOUT_BREAKPOINT_WIDTHS.desktop)).toBe("desktop");
    expect(precedenceMatrix(390).applies).toEqual(["tablet", "mobile"]);
    expect(precedenceMatrix(768).applies).toEqual(["tablet"]);
    expect(precedenceMatrix(1280).applies).toEqual([]);
  });
});

describe("shared resolution inheritance and reset", () => {
  it("keeps legacy stack/gap defaults when override fields are absent", () => {
    expect(resolveSectionPresentation({ gap: "md" }, undefined, 768)).toMatchObject({ gap: "md", stack: true });
    expect(resolveSectionPresentation(undefined, undefined, LAYOUT_STACK_DEFAULT_MIN_WIDTH)).toMatchObject({ gap: "md", stack: false });
  });

  it("applies mobile-only spacing and restores inheritance after reset", () => {
    const responsive = { mobile: { gap: "lg" as const } };
    expect(resolveSectionPresentation({ gap: "sm" }, responsive, 390).gap).toBe("lg");
    expect(resolveSectionPresentation({ gap: "sm" }, responsive, 768).gap).toBe("sm");
    const cleared = resetResponsiveProperty(responsive, "mobile", "gap");
    expect(cleared).toBeUndefined();
    expect(resolveSectionPresentation({ gap: "sm" }, cleared, 390).gap).toBe("sm");
  });

  it("lets mobile win over tablet and tablet win over desktop base", () => {
    const responsive = {
      tablet: { gap: "sm" as const, stack: false },
      mobile: { gap: "none" as const, stack: true },
    };
    expect(resolveSectionPresentation({ gap: "lg" }, responsive, 1280)).toMatchObject({ gap: "lg", stack: false });
    expect(resolveSectionPresentation({ gap: "lg" }, responsive, 900)).toMatchObject({ gap: "sm", stack: false });
    expect(resolveSectionPresentation({ gap: "lg" }, responsive, 390)).toMatchObject({ gap: "none", stack: true });
    expect(setResponsiveProperty(undefined, "tablet", "stack", true)).toEqual({ tablet: { stack: true } });
  });

  it("resolves widget spacing without accepting stack", () => {
    expect(resolveWidgetPresentation({ gap: "md" }, { mobile: { gap: "none" } }, 390).gap).toBe("none");
    expect(resolveWidgetPresentation({ gap: "md" }, { mobile: { gap: "none" } }, 1280).gap).toBe("md");
  });
});

describe("contract validation for responsive fields", () => {
  it("accepts approved overrides and rejects unknown breakpoint or property tokens", () => {
    expect(validateVisualLayout(responsiveFixture).ok).toBe(true);
    for (const name of ["unknown-breakpoint", "unknown-responsive-property", "widget-stack-forbidden"]) {
      const fixture = fixtures.find((entry) => entry.name === name)!;
      expect(validateVisualLayout(fixture.layout).ok).toBe(false);
    }
  });
});

describe("preview and public parity at viewport boundaries", () => {
  it("emits the same resolved gap/stack attributes for preview and public at each width", () => {
    const widths = [390, 767, 768, 900, 1279, 1280];
    for (const width of widths) {
      const preview = render(
        <PublicPageView page={pageDoc(responsiveFixture)} privateMediaBase="/admin/sites/11/media" viewportWidth={width} />,
      );
      const pub = render(<PublicPageView page={pageDoc(responsiveFixture)} viewportWidth={width} />);
      const previewSection = preview.container.querySelector("[data-node-id='section-1']")!;
      const publicSection = pub.container.querySelector("[data-node-id='section-1']")!;
      expect(previewSection.getAttribute("data-resolved-breakpoint")).toBe(publicSection.getAttribute("data-resolved-breakpoint"));
      expect(previewSection.getAttribute("data-resolved-gap")).toBe(publicSection.getAttribute("data-resolved-gap"));
      expect(previewSection.getAttribute("data-resolved-stack")).toBe(publicSection.getAttribute("data-resolved-stack"));
      const previewWidget = preview.container.querySelector("[data-node-id='heading-1']")!;
      const publicWidget = pub.container.querySelector("[data-node-id='heading-1']")!;
      expect(previewWidget.getAttribute("data-resolved-gap")).toBe(publicWidget.getAttribute("data-resolved-gap"));
      preview.unmount();
      pub.unmount();
    }
  });

  it("keeps legacy three-column defaults identical without override fields", () => {
    const legacy = resolveSectionPresentation(undefined, undefined, 1280);
    const view = render(<VisualLayoutView layout={legacyFixture} siteId={11} pageTitle="Legacy" viewportWidth={1280} />);
    const section = view.container.querySelector("[data-node-id='section-1']")!;
    expect(section.getAttribute("data-resolved-gap")).toBe(legacy.gap);
    expect(section.getAttribute("data-resolved-stack")).toBe(String(legacy.stack));
    expect(section.getAttribute("data-resolved-breakpoint")).toBe("desktop");
  });

  it("applies mobile spacing override only below the tablet floor", () => {
    const mobile = render(<VisualLayoutView layout={responsiveFixture} siteId={11} pageTitle="Mobile" viewportWidth={390} />);
    const tablet = render(<VisualLayoutView layout={responsiveFixture} siteId={11} pageTitle="Tablet" viewportWidth={768} />);
    expect(mobile.container.querySelector("[data-node-id='section-1']")!.getAttribute("data-resolved-gap")).toBe("lg");
    expect(tablet.container.querySelector("[data-node-id='section-1']")!.getAttribute("data-resolved-gap")).toBe("md");
    expect(mobile.container.querySelector("[data-node-id='heading-1']")!.getAttribute("data-resolved-gap")).toBe("none");
    expect(tablet.container.querySelector("[data-node-id='heading-1']")!.getAttribute("data-resolved-gap")).toBe("sm");
  });
});
