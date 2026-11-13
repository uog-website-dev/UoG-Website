"use client";

import { SitePagesPanel } from "@/sites/site-pages";
import { SiteSection, useSiteAdmin } from "@/sites/site-admin-frame";

export default function SitePagesAdminPage() {
  const { site, permissions, enabledModuleCodes } = useSiteAdmin();
  return (
    <SiteSection sectionKey="pages">
      <SitePagesPanel
        siteId={site.id}
        pagesEnabled
        builderEnabled={enabledModuleCodes.includes("VISUAL_BUILDER")}
        permissions={permissions}
        languages={site.defaultLanguage ? {
          defaultLanguage: site.defaultLanguage,
          enabled: site.enabledLanguages ?? [site.defaultLanguage],
        } : undefined}
      />
    </SiteSection>
  );
}
