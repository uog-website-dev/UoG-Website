/**
 * Shared title-banner types and pure helpers.
 *
 * Kept free of "use client" so public-web server modules (metadata, RSC) can
 * resolve Site banner config without importing the React banner component.
 */

export type PublicTitleBannerStyle = {
  enabled: boolean;
  background_type: "color" | "image" | "pattern";
  image_url?: string | null;
  pattern: string;
  background_color: string;
  overlay_color: string;
  overlay_opacity: number;
  height: "sm" | "md" | "lg";
  title_color: string;
  title_align: "left" | "center" | "right";
  content_position: "top" | "center" | "bottom";
  padding_y: "sm" | "md" | "lg";
};

export type PublicTitleBannerConfig = {
  scope: "shared" | "independent";
  shared: PublicTitleBannerStyle;
  page: PublicTitleBannerStyle;
  post: PublicTitleBannerStyle;
};

export const DEFAULT_PUBLIC_BANNER_STYLE: PublicTitleBannerStyle = {
  enabled: true,
  background_type: "pattern",
  image_url: null,
  pattern: "gradient-navy",
  background_color: "#003366",
  overlay_color: "#001a33",
  overlay_opacity: 0.35,
  height: "md",
  title_color: "#ffffff",
  title_align: "left",
  content_position: "center",
  padding_y: "md",
};

export const DEFAULT_PUBLIC_BANNER: PublicTitleBannerConfig = {
  scope: "shared",
  shared: DEFAULT_PUBLIC_BANNER_STYLE,
  page: DEFAULT_PUBLIC_BANNER_STYLE,
  post: DEFAULT_PUBLIC_BANNER_STYLE,
};

export function bannerStyleFromUnknown(value: unknown): PublicTitleBannerStyle | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const backgroundType = row.background_type;
  if (backgroundType !== "color" && backgroundType !== "image" && backgroundType !== "pattern") return null;
  return {
    enabled: row.enabled !== false,
    background_type: backgroundType,
    image_url: typeof row.image_url === "string" ? row.image_url : null,
    pattern: typeof row.pattern === "string" ? row.pattern : DEFAULT_PUBLIC_BANNER_STYLE.pattern,
    background_color: typeof row.background_color === "string" ? row.background_color : DEFAULT_PUBLIC_BANNER_STYLE.background_color,
    overlay_color: typeof row.overlay_color === "string" ? row.overlay_color : DEFAULT_PUBLIC_BANNER_STYLE.overlay_color,
    overlay_opacity: typeof row.overlay_opacity === "number" ? row.overlay_opacity : DEFAULT_PUBLIC_BANNER_STYLE.overlay_opacity,
    height: row.height === "sm" || row.height === "lg" ? row.height : "md",
    title_color: typeof row.title_color === "string" ? row.title_color : DEFAULT_PUBLIC_BANNER_STYLE.title_color,
    title_align: row.title_align === "center" || row.title_align === "right" ? row.title_align : "left",
    content_position: row.content_position === "top" || row.content_position === "bottom" ? row.content_position : "center",
    padding_y: row.padding_y === "sm" || row.padding_y === "lg" ? row.padding_y : "md",
  };
}

export function resolveContentBannerStyle(
  banner: PublicTitleBannerConfig | null | undefined,
  contentType: "page" | "post",
  override?: PublicTitleBannerStyle | null,
): PublicTitleBannerStyle {
  if (override) return override;
  const config = banner ?? DEFAULT_PUBLIC_BANNER;
  if (config.scope === "independent") {
    return config[contentType] ?? config.shared ?? DEFAULT_PUBLIC_BANNER_STYLE;
  }
  return config.shared ?? DEFAULT_PUBLIC_BANNER_STYLE;
}
