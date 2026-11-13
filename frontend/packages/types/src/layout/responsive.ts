/**
 * Shared breakpoint resolution for editor preview and public output.
 *
 * Desktop is the base surface (`style`). Tablet/mobile may override a
 * restricted property set. Omitting a key inherits the next wider value;
 * reset deletes the key. Legacy layouts without `responsive` keep the
 * historical stack threshold at 900px.
 */
import type {
  GapToken,
  LayoutBreakpoint,
  LayoutOverrideBreakpoint,
  LayoutStyle,
  SectionResponsive,
  SectionResponsiveOverride,
  WidgetResponsive,
  WidgetResponsiveOverride,
} from "./generated";

export const LAYOUT_BREAKPOINT_WIDTHS = {
  desktop: 1280,
  tablet: 768,
  mobile: 390,
} as const;

/** Inclusive ranges used for resolve + CSS container queries. */
export const LAYOUT_BREAKPOINT_RANGES = {
  mobile: { max: 767 },
  tablet: { min: 768, max: 1279 },
  desktop: { min: 1280 },
} as const;

/** Historical default: side-by-side columns only at/above this container width. */
export const LAYOUT_STACK_DEFAULT_MIN_WIDTH = 900;

export const LAYOUT_OVERRIDE_BREAKPOINTS = ["tablet", "mobile"] as const satisfies readonly LayoutOverrideBreakpoint[];

export type ResolvedSectionPresentation = {
  breakpoint: LayoutBreakpoint;
  gap: GapToken;
  stack: boolean;
  align: NonNullable<LayoutStyle["align"]>;
  tone: NonNullable<LayoutStyle["tone"]>;
};

export type ResolvedWidgetPresentation = {
  breakpoint: LayoutBreakpoint;
  gap: GapToken;
  align: NonNullable<LayoutStyle["align"]>;
  tone: NonNullable<LayoutStyle["tone"]>;
};

export function breakpointAtWidth(width: number): LayoutBreakpoint {
  if (width <= LAYOUT_BREAKPOINT_RANGES.mobile.max) return "mobile";
  if (width <= LAYOUT_BREAKPOINT_RANGES.tablet.max) return "tablet";
  return "desktop";
}

function inheritGap(
  base: GapToken,
  responsive: SectionResponsive | WidgetResponsive | undefined,
  breakpoint: LayoutBreakpoint,
): GapToken {
  let gap = base;
  if (breakpoint === "tablet" || breakpoint === "mobile") {
    const tablet = responsive?.tablet?.gap;
    if (tablet !== undefined) gap = tablet;
  }
  if (breakpoint === "mobile") {
    const mobile = responsive?.mobile?.gap;
    if (mobile !== undefined) gap = mobile;
  }
  return gap;
}

function inheritStack(
  width: number,
  responsive: SectionResponsive | undefined,
  breakpoint: LayoutBreakpoint,
): boolean {
  // Legacy default when no override is present at this or a wider override token.
  let stack = width < LAYOUT_STACK_DEFAULT_MIN_WIDTH;
  if (breakpoint === "tablet" || breakpoint === "mobile") {
    if (responsive?.tablet?.stack !== undefined) stack = responsive.tablet.stack;
  }
  if (breakpoint === "mobile") {
    if (responsive?.mobile?.stack !== undefined) stack = responsive.mobile.stack;
  }
  return stack;
}

export function resolveSectionPresentation(
  style: LayoutStyle | undefined,
  responsive: SectionResponsive | undefined,
  width: number,
): ResolvedSectionPresentation {
  const breakpoint = breakpointAtWidth(width);
  return {
    breakpoint,
    gap: inheritGap(style?.gap ?? "md", responsive, breakpoint),
    stack: inheritStack(width, responsive, breakpoint),
    align: style?.align ?? "start",
    tone: style?.tone ?? "default",
  };
}

export function resolveWidgetPresentation(
  style: LayoutStyle | undefined,
  responsive: WidgetResponsive | undefined,
  width: number,
): ResolvedWidgetPresentation {
  const breakpoint = breakpointAtWidth(width);
  return {
    breakpoint,
    gap: inheritGap(style?.gap ?? "md", responsive, breakpoint),
    align: style?.align ?? "start",
    tone: style?.tone ?? "default",
  };
}

/** Remove one override key; drop empty breakpoint objects and empty maps. */
export function resetResponsiveProperty<
  T extends SectionResponsive | WidgetResponsive,
  K extends keyof (SectionResponsiveOverride & WidgetResponsiveOverride),
>(responsive: T | undefined, breakpoint: LayoutOverrideBreakpoint, key: K): T | undefined {
  if (!responsive?.[breakpoint]) return responsive;
  const nextBreakpoint = { ...responsive[breakpoint] };
  delete nextBreakpoint[key as keyof typeof nextBreakpoint];
  const next = { ...responsive } as T;
  if (Object.keys(nextBreakpoint).length === 0) delete next[breakpoint];
  else (next as Record<string, unknown>)[breakpoint] = nextBreakpoint;
  return Object.keys(next).length === 0 ? undefined : next;
}

export function setResponsiveProperty<
  T extends SectionResponsive | WidgetResponsive,
  K extends keyof (SectionResponsiveOverride & WidgetResponsiveOverride),
>(
  responsive: T | undefined,
  breakpoint: LayoutOverrideBreakpoint,
  key: K,
  value: (SectionResponsiveOverride & WidgetResponsiveOverride)[K],
): T {
  return {
    ...(responsive ?? {}),
    [breakpoint]: {
      ...(responsive?.[breakpoint] ?? {}),
      [key]: value,
    },
  } as T;
}

/** Precedence matrix rows for DoD / contract tests. */
export function precedenceMatrix(width: number): {
  width: number;
  breakpoint: LayoutBreakpoint;
  applies: LayoutOverrideBreakpoint[];
} {
  const breakpoint = breakpointAtWidth(width);
  return {
    width,
    breakpoint,
    applies:
      breakpoint === "mobile" ? ["tablet", "mobile"] :
      breakpoint === "tablet" ? ["tablet"] :
      [],
  };
}
