/**
 * One visible H1 per Page.
 *
 * The Visual Builder can hide the automatic Page title and let a hero supply
 * the main heading. Both surfaces (public renderer and builder canvas) must
 * resolve that decision the same way, so this module is the single source of
 * truth for:
 *
 * - whether the Page title is the visible H1;
 * - whether layout H1s must be demoted because the title already owns it;
 * - whether the author's settings would publish zero or multiple H1s.
 *
 * Published Pages are never left structurally broken: when the saved settings
 * would publish zero or several H1s, the Page title takes ownership and layout
 * H1s are demoted. The builder reports the same condition as a blocking field
 * error before save or publish.
 */
import type { VisualLayout, WidgetNode } from "@uog/types";

/** Builder error path for the Page settings control. */
export const PAGE_HEADING_ERROR_PATH = "metadata.visual_layout.settings.show_title";

export interface PageHeadingResolution {
  /** True when the Page title renders as the visible H1. */
  titleVisible: boolean;
  /** True when layout widgets must not render an H1. */
  demoteLayoutH1: boolean;
  /** H1 elements the layout supplies when H1s are not demoted. */
  layoutH1Count: number;
  /** False when saving would publish zero or multiple visible H1s. */
  ok: boolean;
  /** Field-level builder message; empty when `ok`. */
  message: string;
}

interface HeadingCandidate {
  type: string;
  props?: unknown;
}

function isH1(candidate: HeadingCandidate): boolean {
  if (candidate.type !== "hero_image") return false;
  return (candidate.props as { heading_level?: unknown } | undefined)?.heading_level === 1;
}

function widgetH1Count(widget: WidgetNode): number {
  if (isH1(widget)) return 1;
  // A carousel shows one slide at a time, so any H1 slide still yields one
  // visible H1.
  if (widget.type === "layout_slider" || widget.type === "anything_carousel") {
    return widget.props.items.some(slide => slide.children.some(isH1)) ? 1 : 0;
  }
  // Masonry renders every child.
  if (widget.type === "simple_masonry") {
    return widget.props.items.reduce(
      (total, item) => total + item.children.filter(isH1).length,
      0,
    );
  }
  return 0;
}

/** Count the H1 elements a layout supplies before Page-title resolution. */
export function countLayoutH1(layout: VisualLayout): number {
  return layout.rows.reduce(
    (rows, row) =>
      rows +
      row.columns.reduce(
        (columns, column) =>
          columns + column.children.reduce((sum, widget) => sum + widgetH1Count(widget), 0),
        0,
      ),
    0,
  );
}

function messageFor(showTitle: boolean, layoutH1Count: number): string {
  if (showTitle && layoutH1Count > 0) {
    return layoutH1Count > 1
      ? "The Page title is shown, so it is the only H1. Set each hero heading level to H2–H4, or hide the Page title and keep exactly one H1."
      : "The Page title is shown, so it is the only H1. Set the hero heading level to H2–H4, or hide the Page title and let the hero be the H1.";
  }
  if (!showTitle && layoutH1Count === 0) {
    return "The Page title is hidden, so one widget must be the H1. Set a hero heading level to H1, or show the Page title.";
  }
  return "Only one visible H1 is allowed. Keep one hero at H1 and set the others to H2–H4, or show the Page title.";
}

export function resolvePageHeading(layout: VisualLayout): PageHeadingResolution {
  const showTitle = layout.settings?.show_title !== false;
  const layoutH1Count = countLayoutH1(layout);
  const ok = showTitle ? layoutH1Count === 0 : layoutH1Count === 1;
  // Safe default for existing or invalid layouts: the Page title owns the H1.
  const titleVisible = showTitle || !ok;
  return {
    titleVisible,
    demoteLayoutH1: titleVisible,
    layoutH1Count,
    ok,
    message: ok ? "" : messageFor(showTitle, layoutH1Count),
  };
}
