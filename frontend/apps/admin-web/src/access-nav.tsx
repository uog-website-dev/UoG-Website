"use client";

import { useEffect, useState } from "react";

import type { AdminNavItem } from "@/navigation";

export function AccessNav({
  items,
  children,
}: {
  items: AdminNavItem[];
  children: (visibleItems: AdminNavItem[]) => React.ReactNode;
}) {
  const [permissions, setPermissions] = useState<string[] | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/admin/api/access/", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { permissions: [] }))
      .then((payload: { permissions?: unknown }) => {
        if (!active) return;
        const granted = Array.isArray(payload.permissions)
          ? payload.permissions.filter((item): item is string => typeof item === "string")
          : [];
        setPermissions(granted);
      })
      .catch(() => active && setPermissions([]));
    return () => {
      active = false;
    };
  }, []);

  const visibleItems = permissions === null
    ? items.filter((item) => !item.requiresAny)
    : items.filter((item) => !item.requiresAny || item.requiresAny.some((code) => permissions.includes(code)));

  return children(visibleItems);
}
