"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { EVENT_NAV_ITEMS, eventAdminHref } from "@/sites/site-admin";
import { normalizeAdminPathname } from "@/navigation";
import { useSiteAdmin } from "@/sites/site-admin-frame";

export function SiteEventsNav({ title, description }: { title: string; description: string }) {
  const { site } = useSiteAdmin();
  const path = normalizeAdminPathname(usePathname());
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Box>
        <Typography component="h1" variant="h4" sx={{ fontWeight: 700 }}>{title}</Typography>
        <Typography color="text.secondary">{description}</Typography>
      </Box>
      <Box component="nav" aria-label="Events" sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        {EVENT_NAV_ITEMS.map((item) => {
          const href = eventAdminHref(site.id, item.suffix);
          const active = item.suffix
            ? path === href || path.startsWith(`${href}/`)
            : path === href || path === `${href}/` || /\/events\/[^/]+\/edit\/?$/.test(path);
          return (
            <Button
              key={item.key}
              component={Link}
              href={href}
              variant={active ? "contained" : "outlined"}
              size="small"
            >
              {item.label}
            </Button>
          );
        })}
      </Box>
    </Box>
  );
}
