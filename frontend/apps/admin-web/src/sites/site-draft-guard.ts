"use client";
import {useEffect, useRef} from "react";

/** A completed write still invalidates its Site, but must not navigate a new view. */
export function useSiteOperationGuard(siteId: number) {
  const active = useRef({siteId, mounted: true});
  useEffect(() => {
    active.current = {siteId, mounted: true};
    return () => {active.current.mounted = false;};
  }, [siteId]);
  return () => active.current.mounted && active.current.siteId === siteId;
}

/** Editors keep their own dirty state; the switcher asks all mounted editors once. */
export function useSiteDraftGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const mark = (event: Event) => {
      const detail = (event as CustomEvent<{dirty: boolean}>).detail;
      if (detail) detail.dirty = true;
    };
    window.addEventListener("uog:site:before-switch", mark);
    return () => window.removeEventListener("uog:site:before-switch", mark);
  }, [dirty]);
}

export function confirmSiteSwitch(site?: number) {
  const detail = {site, dirty: false};
  const event = new CustomEvent("uog:site:before-switch", {cancelable: true, detail});
  return window.dispatchEvent(event) && (!detail.dirty || window.confirm("Switch workspace and discard unsaved changes? Saved drafts will remain in their original Site."));
}
