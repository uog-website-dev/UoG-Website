"use client";

import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import type { TitleBannerStyle } from "@uog/types";
import { TitleBannerFields } from "./title-banner-fields";
import { defaultTitleBannerSettings } from "./title-banner-defaults";

export function titleBannerFromMetadata(metadata: Record<string, unknown> | undefined): TitleBannerStyle | null {
  const value = metadata?.title_banner;
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.use_global === true) return null;
  return { ...defaultTitleBannerSettings().shared, ...(value as TitleBannerStyle), enabled: row.enabled !== false };
}

export function TitleBannerOverrideSection({
  siteId,
  value,
  disabled,
  onChange,
}: {
  siteId: number;
  value: TitleBannerStyle | null;
  disabled?: boolean;
  onChange: (next: TitleBannerStyle | null) => void;
}) {
  const useGlobal = value == null;
  return (
    <Box component="section" aria-label="Title banner" sx={{ display: "grid", gap: 2 }}>
      <Typography component="h2" variant="h6">Title banner</Typography>
      <Typography color="text.secondary">
        By default this content uses the Site Appearance banner. Override it here without changing other pages or posts.
      </Typography>
      <FormControlLabel
        control={
          <Switch
            checked={useGlobal}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked ? null : { ...defaultTitleBannerSettings().shared })}
          />
        }
        label="Use Site Appearance banner"
      />
      {!useGlobal && value ? (
        <TitleBannerFields
          siteId={siteId}
          heading="Override banner style"
          disabled={disabled}
          value={value}
          onChange={onChange}
        />
      ) : null}
    </Box>
  );
}
