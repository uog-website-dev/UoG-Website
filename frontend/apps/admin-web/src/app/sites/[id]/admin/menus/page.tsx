"use client";

import { SiteMenusPanel } from "@/sites/site-menus";
import { SiteSection, useSiteAdmin } from "@/sites/site-admin-frame";

export default function SiteMenusAdminPage() {
  const { site } = useSiteAdmin();
  return (
    <SiteSection sectionKey="menus">
      <SiteMenusPanel siteId={site.id} menusEnabled />
    </SiteSection>
  );
}
