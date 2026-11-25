/**
 * One safe content width and gutter rule per Page.
 *
 * The Visual Builder canvas and the public renderer must resolve the same
 * width, the same horizontal gutter and the same bleed decision, so this
 * module is the single source of truth for both surfaces.
 *
 * - `wide` (the default) caps content at 1280 px, `reading` at 880 px, and
 *   `full` uses all available width.
 * - Bleed is an explicit, separate setting (`settings.bleed === true`) and is
 *   the only thing that removes the minimum safe gutter.
 * - Missing, unknown or invalid width values fall back to the safe default.
 */
/** Minimum horizontal inset every Page keeps unless it explicitly bleeds. */
export const PAGE_SAFE_GUTTER_PX = 24;

export const PAGE_CONTENT_WIDTHS = { full: "100%", reading: 880, wide: 1280 } as const;

export type PageWidthToken = keyof typeof PAGE_CONTENT_WIDTHS;

export const DEFAULT_PAGE_WIDTH: PageWidthToken = "wide";

/** Builder path that owns the width field. */
export const PAGE_WIDTH_ERROR_PATH = "metadata.visual_layout.settings.content_width";
/** Builder path that owns the explicit bleed setting. */
export const PAGE_BLEED_ERROR_PATH = "metadata.visual_layout.settings.bleed";

export interface PageWidthResolution {
  /** Width token after the safe fallback. */
  width: PageWidthToken;
  /** CSS max-width for the Page content column. */
  maxWidth: (typeof PAGE_CONTENT_WIDTHS)[PageWidthToken];
  /** Horizontal inset in pixels; 0 only for an explicit bleed. */
  gutter: number;
  /** True only when `settings.bleed` is literally `true`. */
  bleed: boolean;
  /** Human label shared by the builder control and documentation. */
  label: string;
  /** Warning shown while bleed is enabled; empty otherwise. */
  warning: string;
}

const BLEED_WARNING =
  "Bleed removes the 24 px safe gutter, so text and media can touch the viewport edge. Use it only for decorative full-width bands and check narrow screens.";

function isWidthToken(value: unknown): value is PageWidthToken {
  return value === "full" || value === "wide" || value === "reading";
}

function labelFor(width: PageWidthToken): string {
  if (width === "full") return "Full width · 100%";
  if (width === "reading") return "Reading · 880px";
  return "Wide · 1280px";
}

/** Resolve stored settings, tolerating absent or invalid values. */
export function resolvePageWidth(
  settings?: { content_width?: unknown; bleed?: unknown } | null,
): PageWidthResolution {
  const stored = settings?.content_width;
  const width: PageWidthToken = isWidthToken(stored) ? stored : DEFAULT_PAGE_WIDTH;
  const bleed = settings?.bleed === true;
  return {
    width,
    maxWidth: bleed ? "100%" : PAGE_CONTENT_WIDTHS[width],
    gutter: bleed ? 0 : PAGE_SAFE_GUTTER_PX,
    bleed,
    label: labelFor(width),
    warning: bleed ? BLEED_WARNING : "",
  };
}

/**
 * Normalise only the page-width settings before a public document is
 * validated, so an unknown width token or a non-boolean bleed value falls back
 * to the safe default instead of making the whole Page unavailable.
 * Nothing else in the layout is rewritten.
 */
export function withSafePageWidth(layout: unknown): unknown {
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) return layout;
  const doc = layout as { settings?: unknown };
  if (!doc.settings || typeof doc.settings !== "object" || Array.isArray(doc.settings)) return layout;
  const settings = { ...(doc.settings as Record<string, unknown>) };
  let changed = false;
  if ("content_width" in settings && !isWidthToken(settings.content_width)) {
    settings.content_width = DEFAULT_PAGE_WIDTH;
    changed = true;
  }
  if ("bleed" in settings && typeof settings.bleed !== "boolean") {
    delete settings.bleed;
    changed = true;
  }
  return changed ? { ...doc, settings } : layout;
}
