"use client";

/**
 * Load the menu for the Site the backend resolved from this request's Host.
 *
 * The URL has no Site id. A 404 (unknown host or MENUS disabled) renders no
 * navigation instead of falling back to another Site.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { PublicMenuFrame, menusFromResponse } from "@uog/ui";
import type { PublicMenuNode } from "@uog/ui";

const EMPTY: { header: PublicMenuNode[]; footer: PublicMenuNode[] } = {
  header: [],
  footer: [],
};

export const PUBLIC_MENUS_PATH = "/api/v1/site-context/menus/";

export function PublicMenus({ children }: { children: ReactNode }) {
  const [menus, setMenus] = useState(EMPTY);

  useEffect(() => {
    let cancelled = false;
    fetch(PUBLIC_MENUS_PATH, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(async (response) => {
        const body = response.ok ? await response.json().catch(() => null) : null;
        if (!cancelled) setMenus(menusFromResponse(response.status, body));
      })
      .catch(() => {
        if (!cancelled) setMenus(EMPTY);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PublicMenuFrame header={menus.header} footer={menus.footer}>
      {children}
    </PublicMenuFrame>
  );
}
