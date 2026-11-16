"use client";
import {useEffect, useRef, useState, type ReactNode} from "react";
import {usePathname} from "next/navigation";
import {normalizeAdminPathname, siteWorkspaceId} from "@/navigation";
import {QueryScope} from "./query-cache";

export function AdminQueryProvider({identity, children}: {identity: string; children: ReactNode}) {
  const siteId = siteWorkspaceId(normalizeAdminPathname(usePathname()));
  const [session, setSession] = useState({prop: identity, identity});
  const [epoch, setEpoch] = useState(0);
  const [signedOut, setSignedOut] = useState(false);
  const current = session.prop === identity ? session.identity : identity;
  const authorization = useRef("bootstrap");
  const deniedContext = useRef<string | null>(null);
  const denied = (event?: Event) => {
    const deniedSite = event ? (event as CustomEvent<{site?: number}>).detail?.site : undefined;
    if (deniedSite !== undefined && deniedSite !== siteId) return;
    const key = `${current}:${siteId}:${authorization.current}`;
    if (deniedContext.current === key) return;
    deniedContext.current = key;
    setEpoch(value => value + 1);
  };
  useEffect(() => {
    const changed = (event: Event) => {
      const next = (event as CustomEvent<{identity?: string}>).detail?.identity;
      if (typeof next === "string" && next) setSession({prop: identity, identity: next});
    };
    const clear = () => setSignedOut(true);
    const context = (event: Event) => {
      const detail = (event as CustomEvent<{identity: string; site: number | null; authorization: string}>).detail;
      if (detail?.identity === current && detail.site === siteId) authorization.current = detail.authorization;
    };
    window.addEventListener("uog:session:changed", changed);
    window.addEventListener("uog:session:clear", clear);
    window.addEventListener("uog:access:denied", denied);
    window.addEventListener("uog:authorization:context", context);
    return () => {window.removeEventListener("uog:session:changed", changed); window.removeEventListener("uog:session:clear", clear); window.removeEventListener("uog:access:denied", denied); window.removeEventListener("uog:authorization:context", context);};
  }, [identity, current, siteId]);
  if (signedOut) return <p role="status">Signing out…</p>;
  return <QueryScope key={`${current}:${epoch}`} identity={current} siteId={siteId} onDenied={denied}>{children}</QueryScope>;
}
