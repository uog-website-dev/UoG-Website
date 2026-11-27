import type { TitleBannerSettings, TitleBannerStyle } from "@uog/types";

/** Local defaults for Appearance / editor forms (mirrors api-client / backend). */
export const DEFAULT_TITLE_BANNER_STYLE: TitleBannerStyle = {
  enabled: true,
  background_type: "pattern",
  image_ref: null,
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

export function defaultTitleBannerSettings(): TitleBannerSettings {
  const style = { ...DEFAULT_TITLE_BANNER_STYLE };
  return {
    scope: "shared",
    shared: { ...style },
    page: { ...style },
    post: { ...style },
  };
}
