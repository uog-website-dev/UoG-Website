"use client";

/**
 * Reusable title banner for public pages and posts.
 *
 * Style resolution lives in content-banner-model.ts so server metadata can
 * read Site banner config without importing this client module.
 */
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import type { PublicTitleBannerStyle } from "./content-banner-model";
import { PUBLIC_CONTENT_MAX_WIDTH } from "./page-width";

const HEIGHTS = { sm: { xs: 168, md: 200 }, md: { xs: 220, md: 280 }, lg: { xs: 280, md: 360 } } as const;
const PADDING = { sm: { xs: 2.5, md: 3.5 }, md: { xs: 3.5, md: 5 }, lg: { xs: 4.5, md: 7 } } as const;

/** Institutional heritage motif shared with Featured Image hero panels. */
const HERITAGE_PATTERN =
  'url("data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><path d="M8 0v24h32v16H24v32H0M56 0v16h24v32h16M96 72H64V56H48v32h40v8M8 40h8v16H8" fill="none" stroke="#ffffff" stroke-opacity="0.28" stroke-width="9"/></svg>',
  ) +
  '")';

/** Subtle professional textures. Opacity is tuned to stay readable under navy. */
const PATTERN_LAYERS: Record<string, { image: string; size: string; layers: number }> = {
  "geometric-grid": {
    image:
      "linear-gradient(rgba(255,255,255,.16) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.16) 1px, transparent 1px)",
    size: "32px 32px",
    layers: 2,
  },
  "geometric-dots": {
    image: "radial-gradient(rgba(255,255,255,.28) 1.35px, transparent 1.4px)",
    size: "20px 20px",
    layers: 1,
  },
  "abstract-waves": {
    image:
      "repeating-radial-gradient(ellipse at 0 0, transparent 0 14px, rgba(255,255,255,.22) 15px 16px, transparent 17px 30px)",
    size: "72px 72px",
    layers: 1,
  },
  "minimal-lines": {
    image: "repeating-linear-gradient(180deg, rgba(255,255,255,.14) 0 1px, transparent 1px 20px)",
    size: "auto",
    layers: 1,
  },
  heritage: {
    image: HERITAGE_PATTERN,
    size: "96px 96px",
    layers: 1,
  },
  diamonds: {
    image:
      "repeating-linear-gradient(45deg, rgba(255,255,255,.18) 0 1px, transparent 1px 26px), repeating-linear-gradient(-45deg, rgba(255,255,255,.18) 0 1px, transparent 1px 26px)",
    size: "52px 52px",
    layers: 2,
  },
  diagonal: {
    image: "repeating-linear-gradient(135deg, rgba(255,255,255,.18) 0 1px, transparent 1px 16px)",
    size: "auto",
    layers: 1,
  },
  "chevron-field": {
    image: "repeating-linear-gradient(135deg, rgba(255,255,255,.14) 0 12px, transparent 12px 24px)",
    size: "auto",
    layers: 1,
  },
};

const GRADIENT_PATTERNS: Record<string, string> = {
  "gradient-navy": "linear-gradient(135deg, #003366 0%, #005599 48%, #001a33 100%)",
  "gradient-gold": "linear-gradient(135deg, #003366 0%, #0a4a7a 40%, #c9a227 100%)",
};

/** Large corner chevrons matching institutional title banners. */
const CORNER_CHEVRONS =
  "repeating-linear-gradient(135deg, rgba(255,255,255,.07) 0 14px, transparent 14px 28px)";

export type ContentBannerCrumb = {
  label: string;
  href?: string;
};

export function BannerBreadcrumbs({
  items,
  color,
}: {
  items: ContentBannerCrumb[];
  color: string;
}): ReactNode {
  if (items.length === 0) return null;
  return (
    <Box
      component="nav"
      aria-label="Breadcrumb"
      data-banner-breadcrumbs=""
      sx={{
        mb: { xs: 1.75, md: 2.25 },
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 0.75,
        fontSize: { xs: "0.8125rem", md: "0.875rem" },
        fontWeight: 500,
        letterSpacing: "0.01em",
        lineHeight: 1.4,
        color,
        opacity: 0.78,
      }}
    >
      {items.map((item, index) => {
        const last = index === items.length - 1;
        return (
          <Box key={`${item.label}:${item.href ?? index}`} sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
            {index > 0 ? (
              <Box component="span" aria-hidden sx={{ opacity: 0.7, fontSize: "1.05em", lineHeight: 1 }}>›</Box>
            ) : null}
            {item.href && !last ? (
              <Link
                href={item.href}
                underline="hover"
                color="inherit"
                sx={{
                  minHeight: 44,
                  display: "inline-flex",
                  alignItems: "center",
                  whiteSpace: "nowrap",
                  "&:focus-visible": { outline: "2px solid currentColor", outlineOffset: 3 },
                }}
              >
                {item.label}
              </Link>
            ) : (
              <Typography
                component="span"
                aria-current={last ? "page" : undefined}
                sx={{
                  m: 0,
                  color: "inherit",
                  font: "inherit",
                  fontWeight: last ? 600 : 500,
                  maxWidth: { xs: 160, sm: 280, md: 420 },
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.label}
              </Typography>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

function normalizeCrumbLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Drop crumbs that only repeat the visible H1 (e.g. page title "Messege"). */
export function breadcrumbsWithoutTitleEcho(
  items: ContentBannerCrumb[],
  title: string,
): ContentBannerCrumb[] {
  const current = normalizeCrumbLabel(title);
  if (!current) return items;
  return items.filter((item) => {
    if (item.href) return true;
    return normalizeCrumbLabel(item.label) !== current;
  });
}

/** Build banner crumbs from a public page path — ancestors only; current page is the H1. */
export function crumbsFromPagePath(path: string): ContentBannerCrumb[] {
  const segments = path.split("/").filter(Boolean);
  // Current page name is the banner title — never echo it as a crumb.
  if (segments.length <= 1) return [];
  let href = "";
  return segments.slice(0, -1).map((segment) => {
    href += `/${segment}`;
    const label = decodeURIComponent(segment)
      .replace(/-/g, " ")
      .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
    return { label, href };
  });
}

/** Post detail crumbs: News › Detail (title stays in the H1). */
export function crumbsForPostDetail(): ContentBannerCrumb[] {
  return [
    { label: "News", href: "/posts" },
    { label: "Detail" },
  ];
}

/**
 * Pattern / gradient fill with an optional overlay tint.
 * Overlay uses `100% 100%` so it covers the banner once; texture tiles keep
 * their own size — a shared size was tiling the overlay and washing out patterns.
 */
function patternFill(style: PublicTitleBannerStyle): {
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundColor: string;
} {
  const backgroundColor = style.background_color;
  const overlay = `linear-gradient(${hexToRgba(style.overlay_color, style.overlay_opacity)}, ${hexToRgba(style.overlay_color, style.overlay_opacity)})`;

  if (style.pattern === "minimal-solid") {
    return { backgroundColor, backgroundImage: overlay, backgroundSize: "100% 100%" };
  }

  const gradient = GRADIENT_PATTERNS[style.pattern];
  if (gradient) {
    return {
      backgroundColor,
      backgroundImage: `${overlay}, ${gradient}`,
      backgroundSize: "100% 100%, cover",
    };
  }

  const texture = PATTERN_LAYERS[style.pattern] ?? PATTERN_LAYERS["geometric-grid"]!;
  const tile = texture.size === "auto" ? "auto" : texture.size;
  const patternSizes = Array.from({ length: texture.layers }, () => tile).join(", ");
  return {
    backgroundColor,
    backgroundImage: `${overlay}, ${texture.image}`,
    backgroundSize: `100% 100%, ${patternSizes}`,
  };
}

export function ContentBanner({
  title,
  titleId,
  style,
  subtitle,
  meta,
  breadcrumbs,
  watermarkSrc,
  titleHidden = false,
  children,
}: {
  title: string;
  titleId: string;
  style: PublicTitleBannerStyle;
  subtitle?: ReactNode;
  meta?: ReactNode;
  breadcrumbs?: ContentBannerCrumb[];
  /** Large faded crest/logo watermark behind the title. */
  watermarkSrc?: string | null;
  /** Keep an accessible title for layout heroes that already expose an H1. */
  titleHidden?: boolean;
  children?: ReactNode;
}): ReactNode {
  const crumbItems = breadcrumbsWithoutTitleEcho(breadcrumbs ?? [], title);

  if (!style.enabled) {
    return (
      <Box data-content-banner="plain" sx={{ maxWidth: PUBLIC_CONTENT_MAX_WIDTH, width: "100%", mx: "auto", px: { xs: 2, sm: 3, md: 4 }, pt: { xs: 3, md: 4 } }}>
        {crumbItems.length > 0 ? (
          <Box sx={{ color: "text.secondary", mb: { xs: 1.75, md: 2.25 } }}>
            <BannerBreadcrumbs items={crumbItems} color="inherit" />
          </Box>
        ) : null}
        <Typography
          id={titleId}
          component={titleHidden ? "span" : "h1"}
          variant="h3"
          sx={titleHidden
            ? { position: "absolute", left: 0, top: 0, width: 1, height: 1, p: 0, m: -1, overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap" }
            : { overflowWrap: "anywhere", fontWeight: 750, letterSpacing: "-0.02em" }}
        >
          {title}
        </Typography>
        {subtitle}
        {meta}
        {children}
      </Box>
    );
  }

  const minHeight = HEIGHTS[style.height];
  const padding = PADDING[style.padding_y];
  const justify =
    style.content_position === "top" ? "flex-start"
      : style.content_position === "bottom" ? "flex-end"
        : "center";
  const textAlign = style.title_align;
  const background =
    style.background_type === "image" && style.image_url
      ? {
          backgroundColor: style.background_color,
          backgroundImage: `linear-gradient(${hexToRgba(style.overlay_color, style.overlay_opacity)}, ${hexToRgba(style.overlay_color, style.overlay_opacity)}), url(${style.image_url})`,
          backgroundSize: "100% 100%, cover",
          backgroundPosition: "center",
        }
      : style.background_type === "color"
        ? {
            backgroundColor: style.background_color,
            backgroundImage: `linear-gradient(${hexToRgba(style.overlay_color, Math.min(style.overlay_opacity, 0.45))}, ${hexToRgba(style.overlay_color, Math.min(style.overlay_opacity, 0.45))})`,
            backgroundSize: "100% 100%",
          }
        : patternFill(style);

  return (
    <Box
      component="header"
      aria-label="Content banner"
      data-content-banner="styled"
      sx={{
        position: "relative",
        width: "100%",
        minHeight,
        display: "flex",
        alignItems: justify,
        overflow: "hidden",
        color: style.title_color,
        isolation: "isolate",
        ...background,
      }}
    >
      {/* Corner chevron washes */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          backgroundImage: CORNER_CHEVRONS,
          backgroundSize: "auto",
          opacity: 0.9,
          maskImage:
            "radial-gradient(ellipse 55% 70% at 0% 0%, #000 0%, transparent 70%), radial-gradient(ellipse 55% 70% at 100% 100%, #000 0%, transparent 70%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 55% 70% at 0% 0%, #000 0%, transparent 70%), radial-gradient(ellipse 55% 70% at 100% 100%, #000 0%, transparent 70%)",
          zIndex: 0,
        }}
      />

      {watermarkSrc ? (
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            pointerEvents: "none",
            zIndex: 0,
          }}
        >
          <Box
            component="img"
            src={watermarkSrc}
            alt=""
            referrerPolicy="no-referrer"
            sx={{
              width: { xs: 200, sm: 260, md: 320 },
              height: { xs: 200, sm: 260, md: 320 },
              objectFit: "contain",
              opacity: 0.12,
              filter: "grayscale(0.15) brightness(1.35)",
              userSelect: "none",
            }}
          />
        </Box>
      ) : null}

      <Box
        sx={{
          position: "relative",
          zIndex: 1,
          maxWidth: PUBLIC_CONTENT_MAX_WIDTH,
          width: "100%",
          mx: "auto",
          px: { xs: 2, sm: 3, md: 4 },
          py: padding,
          textAlign,
        }}
      >
        {crumbItems.length > 0 ? <BannerBreadcrumbs items={crumbItems} color={style.title_color} /> : null}
        <Typography
          id={titleId}
          component={titleHidden ? "span" : "h1"}
          sx={titleHidden
            ? { position: "absolute", left: 0, top: 0, width: 1, height: 1, p: 0, m: -1, overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap" }
            : {
                m: 0,
                color: style.title_color,
                fontWeight: 750,
                letterSpacing: "-0.025em",
                overflowWrap: "anywhere",
                textShadow: "0 1px 2px rgba(0,0,0,.28)",
                fontSize: { xs: "1.75rem", sm: "2.35rem", md: "2.85rem" },
                lineHeight: 1.18,
                maxWidth: textAlign === "center" ? "48ch" : "58ch",
                mx: textAlign === "center" ? "auto" : undefined,
                ml: textAlign === "right" ? "auto" : undefined,
              }}
        >
          {title}
        </Typography>
        {subtitle ? <Box sx={{ mt: 2, color: style.title_color, opacity: 0.92 }}>{subtitle}</Box> : null}
        {meta ? <Box sx={{ mt: 2, color: style.title_color, opacity: 0.85 }}>{meta}</Box> : null}
        {children}
      </Box>
    </Box>
  );
}

function hexToRgba(hex: string, opacity: number): string {
  const value = /^#([0-9a-f]{6})$/i.exec(hex)?.[1] ?? "000000";
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(0.85, opacity))})`;
}
