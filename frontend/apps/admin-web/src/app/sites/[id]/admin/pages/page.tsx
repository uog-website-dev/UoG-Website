"use client";

import { SitePagesPanel } from "@/sites/site-pages";
import { SiteSection, useSiteAdmin } from "@/sites/site-admin-frame";

export default function SitePagesAdminPage() {
  const { site } = useSiteAdmin();
  return (
    <SiteSection sectionKey="pages">
      <SitePagesPanel siteId={site.id} pagesEnabled />
    </SiteSection>
  );
}
