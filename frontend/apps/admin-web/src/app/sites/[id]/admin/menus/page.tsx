"use client";

import { SiteMenusPanel } from "@/sites/site-menus";
import { SiteSection, useSiteAdmin } from "@/sites/site-admin-frame";

export default function SiteMenusAdminPage() {
  const { site, enabledModuleCodes, permissions } = useSiteAdmin();
  return (
    <SiteSection sectionKey="menus">
      <SiteMenusPanel
        siteId={site.id}
        menusEnabled={enabledModuleCodes.includes("MENUS")}
        permissions={permissions}
      />
    </SiteSection>
  );
}
