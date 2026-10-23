"use client";

/**
 * Page breadcrumb for the admin console.
 *
 * Rendered from a serialisable item list so server pages can pass it down.
 * Links go through `next/link` (basePath-aware); the current page is marked
 * with `aria-current="page"` for assistive technology.
 */
import HomeIcon from "@mui/icons-material/Home";
import Box from "@mui/material/Box";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";

export interface BreadcrumbItem {
  label: string;
  /** Omit on the last (current) item. */
  href?: string;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null;

  return (
    <Breadcrumbs
      aria-label="Breadcrumb"
      separator="/"
      sx={{ mb: 2, "& .MuiBreadcrumbs-li": { display: "flex", alignItems: "center" } }}
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        if (isLast || !item.href) {
          return (
            <Typography
              key={`${item.label}-current`}
              variant="body2"
              color="text.secondary"
              aria-current={isLast ? "page" : undefined}
              sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
            >
              {index === 0 && <HomeIcon fontSize="small" sx={{ color: "text.disabled" }} />}
              {item.label}
            </Typography>
          );
        }
        return (
          <Link
            key={item.label}
            href={item.href}
            underline="hover"
            color="inherit"
            variant="body2"
            sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
          >
            {index === 0 && <HomeIcon fontSize="small" sx={{ color: "text.disabled" }} />}
            {item.label}
          </Link>
        );
      })}
    </Breadcrumbs>
  );
}
