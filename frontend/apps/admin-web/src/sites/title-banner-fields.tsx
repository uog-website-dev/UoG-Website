"use client";

/**
 * Shared title-banner controls for Appearance and page/post overrides.
 * Includes a live ContentBanner preview, visual color pickers, and
 * hero-style pattern swatches matching the public banner renderer.
 */
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { TitleBannerPattern, TitleBannerStyle } from "@uog/types";
import { ContentBanner, type PublicTitleBannerStyle } from "@uog/ui";
import { APP_BASE_PATH } from "@/base-path";
import { SiteImageField } from "./site-image-field";

const HEX = /^#[0-9a-fA-F]{6}$/;

const PATTERNS: Array<{ value: TitleBannerPattern; label: string; preview: string; size?: string }> = [
  {
    value: "gradient-navy",
    label: "Navy gradient",
    preview: "linear-gradient(135deg, #003366 0%, #005599 48%, #001a33 100%)",
  },
  {
    value: "gradient-gold",
    label: "Navy to gold",
    preview: "linear-gradient(135deg, #003366 0%, #0a4a7a 40%, #c9a227 100%)",
  },
  {
    value: "heritage",
    label: "Heritage",
    preview:
      'url("data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><path d="M8 0v24h32v16H24v32H0M56 0v16h24v32h16M96 72H64V56H48v32h40v8M8 40h8v16H8" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="9"/></svg>',
      ) +
      '"), #003366',
    size: "48px 48px",
  },
  {
    value: "geometric-grid",
    label: "Grid",
    preview:
      "linear-gradient(rgba(255,255,255,.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.35) 1px, transparent 1px), #003366",
    size: "16px 16px",
  },
  {
    value: "geometric-dots",
    label: "Dots",
    preview: "radial-gradient(rgba(255,255,255,.5) 1.3px, transparent 1.4px), #003366",
    size: "14px 14px",
  },
  {
    value: "diamonds",
    label: "Diamonds",
    preview:
      "repeating-linear-gradient(45deg, rgba(255,255,255,.4) 0 1px, transparent 1px 14px), repeating-linear-gradient(-45deg, rgba(255,255,255,.4) 0 1px, transparent 1px 14px), #003366",
    size: "28px 28px",
  },
  {
    value: "diagonal",
    label: "Diagonal",
    preview: "repeating-linear-gradient(135deg, rgba(255,255,255,.4) 0 1px, transparent 1px 10px), #003366",
  },
  {
    value: "chevron-field",
    label: "Chevrons",
    preview: "repeating-linear-gradient(135deg, rgba(255,255,255,.28) 0 8px, transparent 8px 16px), #003366",
  },
  {
    value: "abstract-waves",
    label: "Waves",
    preview:
      "repeating-radial-gradient(ellipse at 0 0, transparent 0 8px, rgba(255,255,255,.4) 9px 10px, transparent 11px 18px), #003366",
    size: "36px 36px",
  },
  {
    value: "minimal-lines",
    label: "Lines",
    preview: "repeating-linear-gradient(180deg, rgba(255,255,255,.35) 0 1px, transparent 1px 10px), #003366",
  },
  {
    value: "minimal-solid",
    label: "Solid",
    preview: "#003366",
  },
];

function safeHex(value: string, fallback: string): string {
  return HEX.test(value) ? value : fallback;
}

function toPreviewStyle(value: TitleBannerStyle, siteId: number): PublicTitleBannerStyle {
  return {
    enabled: value.enabled,
    background_type: value.background_type,
    image_url: value.image_ref
      ? `${APP_BASE_PATH}/sites/${siteId}/media/${value.image_ref}/image?variant=display`
      : null,
    pattern: value.pattern,
    background_color: value.background_color,
    overlay_color: value.overlay_color,
    overlay_opacity: value.overlay_opacity,
    height: value.height,
    title_color: value.title_color,
    title_align: value.title_align,
    content_position: value.content_position,
    padding_y: value.padding_y,
  };
}

function HexColorField({
  label,
  value,
  disabled,
  onChange,
  helperText = "#RRGGBB",
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (next: string) => void;
  helperText?: string;
}) {
  const picker = safeHex(value, "#003366");
  return (
    <Box>
      <Typography component="label" variant="body2" fontWeight={600} sx={{ display: "block", mb: 0.75 }}>
        {label}
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Box
          component="label"
          sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: 1,
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            p: 0.5,
            pr: 1.25,
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.6 : 1,
            "&:focus-within": { outline: "3px solid", outlineColor: "primary.main", outlineOffset: 2 },
          }}
        >
          <Box
            component="input"
            type="color"
            aria-label={`${label} colour picker`}
            value={picker}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            sx={{
              width: 40,
              height: 30,
              p: 0,
              border: 0,
              borderRadius: 0.75,
              bgcolor: "transparent",
              cursor: "inherit",
              "&::-webkit-color-swatch-wrapper": { p: 0 },
              "&::-webkit-color-swatch": { border: 0, borderRadius: "4px" },
              "&::-moz-color-swatch": { border: 0, borderRadius: "4px" },
            }}
          />
          <Typography variant="caption" component="span" sx={{ fontFamily: "monospace", fontSize: 12 }}>
            Pick
          </Typography>
        </Box>
        <TextField
          size="small"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          inputProps={{ "aria-label": `${label} hex value`, spellCheck: false }}
          sx={{ width: 120, "& input": { fontFamily: "monospace", fontSize: 13 } }}
        />
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
        {helperText}
      </Typography>
    </Box>
  );
}

export function TitleBannerFields({
  siteId,
  value,
  disabled,
  onChange,
  heading = "Banner style",
}: {
  siteId: number;
  value: TitleBannerStyle;
  disabled?: boolean;
  onChange: (next: TitleBannerStyle) => void;
  heading?: string;
}) {
  const previewLocked = disabled || !value.enabled;
  const previewStyle = toPreviewStyle(value, siteId);

  return (
    <Box component="section" aria-label={heading} sx={{ display: "grid", gap: 2.5 }}>
      <Typography component="h3" variant="h6">{heading}</Typography>
      <FormControlLabel
        control={<Switch checked={value.enabled} disabled={disabled} onChange={(event) => onChange({ ...value, enabled: event.target.checked })} />}
        label="Show title banner on public content"
      />

      <Box component="section" aria-label={`${heading} preview`} sx={{ minWidth: 0 }}>
        <Typography component="h4" variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
          Live preview
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Updates as you change colours, pattern, height, and alignment. Visitors see the published Appearance values.
        </Typography>
        <Box
          sx={{
            border: 1,
            borderColor: "divider",
            borderRadius: 2,
            overflow: "hidden",
            bgcolor: "background.default",
            opacity: value.enabled ? 1 : 0.55,
          }}
        >
          <ContentBanner
            title="Sample page title"
            titleId={`banner-preview-title-${heading.replace(/\s+/g, "-").toLowerCase()}`}
            style={previewStyle}
            breadcrumbs={[
              { label: "News", href: "#" },
              { label: "Detail" },
            ]}
          />
          {!value.enabled ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              Banner is turned off for this scope.
            </Typography>
          ) : null}
        </Box>
      </Box>

      <TextField
        select
        label="Background type"
        value={value.background_type}
        disabled={previewLocked}
        onChange={(event) => onChange({ ...value, background_type: event.target.value as TitleBannerStyle["background_type"] })}
        helperText="Image uses the Media Library. Pattern uses an approved built-in style."
      >
        <MenuItem value="pattern">Pattern</MenuItem>
        <MenuItem value="image">Image</MenuItem>
        <MenuItem value="color">Solid color</MenuItem>
      </TextField>
      {value.background_type === "image" ? (
        <SiteImageField
          siteId={siteId}
          label="Banner image"
          optional
          canUpload
          editAltText={false}
          disabled={previewLocked}
          value={{ assetId: value.image_ref, alt: "Banner background" }}
          onChange={(next) => onChange({ ...value, image_ref: next.assetId })}
          helperText="Choose a ready wide image. An overlay keeps the title readable."
        />
      ) : null}
      {value.background_type === "pattern" ? (
        <Box>
          <Typography component="legend" variant="body2" fontWeight={600} sx={{ mb: 1 }}>
            Background pattern
          </Typography>
          <Box
            role="group"
            aria-label="Background pattern"
            sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2,minmax(0,1fr))", sm: "repeat(3,minmax(0,1fr))", md: "repeat(4,minmax(0,1fr))" }, gap: 1 }}
          >
            {PATTERNS.map((pattern) => {
              const active = value.pattern === pattern.value;
              return (
                <Button
                  key={pattern.value}
                  type="button"
                  disabled={previewLocked}
                  aria-label={`Pattern: ${pattern.label}`}
                  aria-pressed={active}
                  onClick={() => onChange({ ...value, pattern: pattern.value })}
                  sx={{
                    minWidth: 0,
                    minHeight: 84,
                    p: 0.75,
                    gap: 0.75,
                    flexDirection: "column",
                    border: active ? "2px solid" : "1px solid",
                    borderColor: active ? "primary.main" : "divider",
                    bgcolor: active ? "action.selected" : "transparent",
                    fontSize: 11,
                    textTransform: "none",
                    "&:focus-visible": { outline: "3px solid", outlineColor: "primary.main", outlineOffset: 2 },
                  }}
                >
                  <Box
                    aria-hidden
                    sx={{
                      width: "100%",
                      height: 40,
                      borderRadius: 1,
                      border: 1,
                      borderColor: "divider",
                      backgroundImage: pattern.preview,
                      backgroundSize: pattern.size,
                      backgroundColor: "#003366",
                    }}
                  />
                  {pattern.label}
                </Button>
              );
            })}
          </Box>
        </Box>
      ) : null}

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
        <HexColorField
          label="Background color"
          value={value.background_color}
          disabled={previewLocked}
          onChange={(background_color) => onChange({ ...value, background_color })}
        />
        <HexColorField
          label="Overlay color"
          value={value.overlay_color}
          disabled={previewLocked}
          onChange={(overlay_color) => onChange({ ...value, overlay_color })}
        />
        <TextField
          label="Overlay opacity"
          type="number"
          inputProps={{ min: 0, max: 0.85, step: 0.05 }}
          value={value.overlay_opacity}
          disabled={previewLocked}
          onChange={(event) => onChange({ ...value, overlay_opacity: Number(event.target.value) })}
        />
        <HexColorField
          label="Title color"
          value={value.title_color}
          disabled={previewLocked}
          onChange={(title_color) => onChange({ ...value, title_color })}
        />
        <TextField
          select
          label="Banner height"
          value={value.height}
          disabled={previewLocked}
          onChange={(event) => onChange({ ...value, height: event.target.value as TitleBannerStyle["height"] })}
        >
          <MenuItem value="sm">Compact</MenuItem>
          <MenuItem value="md">Standard</MenuItem>
          <MenuItem value="lg">Tall</MenuItem>
        </TextField>
        <TextField
          select
          label="Vertical padding"
          value={value.padding_y}
          disabled={previewLocked}
          onChange={(event) => onChange({ ...value, padding_y: event.target.value as TitleBannerStyle["padding_y"] })}
        >
          <MenuItem value="sm">Compact</MenuItem>
          <MenuItem value="md">Standard</MenuItem>
          <MenuItem value="lg">Spacious</MenuItem>
        </TextField>
        <TextField
          select
          label="Title alignment"
          value={value.title_align}
          disabled={previewLocked}
          onChange={(event) => onChange({ ...value, title_align: event.target.value as TitleBannerStyle["title_align"] })}
        >
          <MenuItem value="left">Left</MenuItem>
          <MenuItem value="center">Center</MenuItem>
          <MenuItem value="right">Right</MenuItem>
        </TextField>
        <TextField
          select
          label="Title position"
          value={value.content_position}
          disabled={previewLocked}
          onChange={(event) => onChange({ ...value, content_position: event.target.value as TitleBannerStyle["content_position"] })}
        >
          <MenuItem value="top">Top</MenuItem>
          <MenuItem value="center">Center</MenuItem>
          <MenuItem value="bottom">Bottom</MenuItem>
        </TextField>
      </Box>
    </Box>
  );
}
