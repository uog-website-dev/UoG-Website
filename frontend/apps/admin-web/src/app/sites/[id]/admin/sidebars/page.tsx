"use client";
import { SiteSection, useSiteAdmin } from "@/sites/site-admin-frame";
import { SiteSidebars } from "@/sites/site-sidebars";

export default function SidebarsPage() {
  const { site, permissions, enabledModuleCodes } = useSiteAdmin();
  return <SiteSection sectionKey="sidebars"><SiteSidebars key={site.id} siteId={site.id} permissions={permissions} menusEnabled={enabledModuleCodes.includes("MENUS")} /></SiteSection>;
}
