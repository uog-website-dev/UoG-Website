import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_WIDTH,
  PAGE_CONTENT_WIDTHS,
  PAGE_SAFE_GUTTER_PX,
  resolvePageWidth,
} from "./page-width";

describe("resolvePageWidth", () => {
  it("defaults to Wide with the safe gutter", () => {
    for (const settings of [undefined, null, {}]) {
      const resolved = resolvePageWidth(settings);
      expect(resolved.width).toBe(DEFAULT_PAGE_WIDTH);
      expect(resolved.width).toBe("wide");
      expect(resolved.maxWidth).toBe(1280);
      expect(resolved.gutter).toBe(PAGE_SAFE_GUTTER_PX);
      expect(resolved.gutter).toBe(24);
      expect(resolved.bleed).toBe(false);
      expect(resolved.legacyFullWidth).toBe(false);
      expect(resolved.label).toBe("Wide · 1280px");
    }
  });

  it("keeps the Reading and Wide caps unchanged", () => {
    expect(resolvePageWidth({ content_width: "reading" })).toMatchObject({
      width: "reading", maxWidth: 880, gutter: 24, bleed: false,
    });
    expect(resolvePageWidth({ content_width: "wide" })).toMatchObject({
      width: "wide", maxWidth: 1280, gutter: 24, bleed: false,
    });
    expect(PAGE_CONTENT_WIDTHS).toEqual({ reading: 880, wide: 1280 });
  });

  it("never bleeds for the legacy full token", () => {
    const resolved = resolvePageWidth({ content_width: "full" });
    expect(resolved.maxWidth).toBe("100%");
    expect(resolved.bleed).toBe(false);
    expect(resolved.gutter).toBe(PAGE_SAFE_GUTTER_PX);
    expect(resolved.legacyFullWidth).toBe(true);
    expect(resolved.label).toBe("Full width · legacy");
  });

  it("only bleeds when the explicit setting is literally true", () => {
    const bleeding = resolvePageWidth({ content_width: "wide", bleed: true });
    expect(bleeding.bleed).toBe(true);
    expect(bleeding.gutter).toBe(0);
    expect(bleeding.warning).toContain("24 px safe gutter");

    for (const value of ["true", 1, {}, "false", false, undefined, null]) {
      const resolved = resolvePageWidth({ content_width: "wide", bleed: value });
      expect(resolved.bleed).toBe(false);
      expect(resolved.gutter).toBe(PAGE_SAFE_GUTTER_PX);
      expect(resolved.warning).toBe("");
    }
  });

  it("falls back to the safe default for unknown or invalid widths", () => {
    for (const value of ["huge", "", "Wide", 1280, true, {}, [], null]) {
      const resolved = resolvePageWidth({ content_width: value });
      expect(resolved.width).toBe("wide");
      expect(resolved.maxWidth).toBe(1280);
      expect(resolved.gutter).toBe(PAGE_SAFE_GUTTER_PX);
      expect(resolved.legacyFullWidth).toBe(false);
    }
  });

  it("keeps the gutter independent of the content width", () => {
    for (const width of ["reading", "wide", "full"] as const) {
      expect(resolvePageWidth({ content_width: width }).gutter).toBe(24);
    }
  });
});
