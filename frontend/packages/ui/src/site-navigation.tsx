"use client";

/**
 * Public Site navigation rendered from the host-resolved menu payload.
 *
 * The Site id is never chosen here. Callers pass only the header and footer
 * trees from `GET /api/v1/site-context/menus/`. A disabled MENUS module is a
 * 404 from that endpoint and becomes an empty tree, so nothing from another
 * Site is substituted.
 */
import { useId, useState } from "react";
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import MenuIcon from "@mui/icons-material/Menu";
import CloseIcon from "@mui/icons-material/Close";

export interface PublicMenuNode {
  label: string;
  href: string;
  children?: PublicMenuNode[];
}

const SAFE_PATH = /^\/(?!\/)(?!\\)[A-Za-z0-9\-._~%!$&'()*+,;=:@/?#]*$/;

/** Accept a same-site path or an http(s) URL. Reject scriptable and protocol-relative targets. */
export function safeMenuHref(value: string): string | null {
  if (typeof value !== "string") return null;
  const href = value.trim();
  if (!href || /[\u0000-\u0020\u007f\\]/.test(href)) return null;
    if (/^#[a-z][a-z0-9-]{0,63}$/.test(href)) return href;
  if (href.startsWith("/")) {
    return SAFE_PATH.test(href) ? href : null;
  }
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.toString();
}

/** Turn the public menu response into header and footer trees. 404 yields empty trees. */
export function menusFromResponse(
  status: number,
  body: unknown,
): { header: PublicMenuNode[]; footer: PublicMenuNode[] } {
  if (status === 404 || body == null || typeof body !== "object") {
    return { header: [], footer: [] };
  }
  const locations = (body as { locations?: unknown }).locations;
  const record = locations != null && typeof locations === "object" ? locations as Record<string, unknown> : {};
  return {
    header: normalizeNodes(record.header),
    footer: normalizeNodes(record.footer),
  };
}

function normalizeNodes(value: unknown): PublicMenuNode[] {
  if (!Array.isArray(value)) return [];
  const nodes: PublicMenuNode[] = [];
  for (const entry of value) {
    if (entry == null || typeof entry !== "object") continue;
    const row = entry as { label?: unknown; href?: unknown; children?: unknown };
    if (typeof row.label !== "string" || !row.label.trim()) continue;
    const href = typeof row.href === "string" ? safeMenuHref(row.href) : null;
    nodes.push({
      label: row.label.trim(),
      href: href ?? "",
      children: normalizeNodes(row.children),
    });
  }
  return nodes;
}

function MenuLinks({ items, depth = 0 }: { items: PublicMenuNode[]; depth?: number }) {
  return (
    <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, pl: depth ? 2 : 0 }}>
      {items.map((item) => {
        const href = safeMenuHref(item.href);
        return (
        <Box component="li" key={`${depth}-${item.label}-${item.href}`} sx={{ py: 0.25 }}>
          {href ? (
            <Link href={href} color="inherit" underline="hover">
              {item.label}
            </Link>
          ) : (
            <Box component="span">{item.label}</Box>
          )}
          {item.children && item.children.length > 0 ? (
            <MenuLinks items={item.children} depth={depth + 1} />
          ) : null}
        </Box>
        );
      })}
    </Box>
  );
}

export function SiteNavigation({
  items,
  label,
  mobile = false,
  dropdown = false,
}: {
  items: PublicMenuNode[];
  label: string;
  mobile?: boolean;
  dropdown?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  if (items.length === 0) return null;
  if(dropdown)return <Box component="nav" aria-label={label}>
    <Box component="ul" sx={{display:"flex",flexWrap:"wrap",gap:1,listStyle:"none",m:0,p:0}}>
      {items.map((item,index)=><Box component="li" key={`${index}-${item.label}`} sx={{position:"relative",minWidth:0,maxWidth:"100%"}}>
        {item.children?.length?<Box component="details" sx={{"& > summary":{cursor:"pointer",minHeight:44,p:1,fontWeight:600,"&:focus-visible":{outline:"3px solid currentColor",outlineOffset:2}}}}>
          <Box component="summary">{item.label}</Box>
          <Box sx={{bgcolor:"background.paper",color:"text.primary",boxShadow:4,borderRadius:2,p:2,maxWidth:"100%",zIndex:4,"@container visual-layout (min-width: 768px)":{position:"absolute",minWidth:240}}}>
            {safeMenuHref(item.href)?<Link href={safeMenuHref(item.href)!} sx={{display:"block",minHeight:44}}>Overview</Link>:null}
            <MenuLinks items={item.children}/>
          </Box>
        </Box>:safeMenuHref(item.href)?<Link href={safeMenuHref(item.href)!} sx={{display:"inline-flex",alignItems:"center",minHeight:44,p:1}}>{item.label}</Link>:<Box component="span">{item.label}</Box>}
      </Box>)}
    </Box>
  </Box>;
  return (
    <Box component="nav" aria-label={label} sx={{ px: 2, py: mobile ? 1 : 0.5 }}>
      {mobile ? (
        <>
          <Box sx={{ display: { xs: "none", md: "block" } }}>
            <MenuLinks items={items} />
          </Box>
          <IconButton
            aria-label={`Open ${label.toLowerCase()}`}
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen(true)}
            sx={{ display: { xs: "inline-flex", md: "none" } }}
          >
            <MenuIcon />
          </IconButton>
          <Drawer anchor="left" open={open} onClose={() => setOpen(false)}>
            <Box sx={{ width: 280, p: 2 }} id={menuId}>
              <IconButton aria-label={`Close ${label.toLowerCase()}`} onClick={() => setOpen(false)}>
                <CloseIcon />
              </IconButton>
              <Box component="div" role="navigation" aria-label={label}>
                <MenuLinks items={items} />
              </Box>
            </Box>
          </Drawer>
        </>
      ) : (
        <MenuLinks items={items} />
      )}
    </Box>
  );
}

export function PublicMenuFrame({
  header,
  footer,
  children,
}: {
  header: PublicMenuNode[];
  footer: PublicMenuNode[];
  children: ReactNode;
}) {
  return (
    <>
      <SiteNavigation items={header} label="Site header" mobile />
      {children}
      <SiteNavigation items={footer} label="Site footer" />
    </>
  );
}
