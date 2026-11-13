"use client";

import { SitePageEditor } from "@/sites/site-page-editor";
import { SiteSection, useSiteAdmin } from "@/sites/site-admin-frame";

export default function SitePageCreatePage() {
  const { site, permissions, enabledModuleCodes } = useSiteAdmin();
  return (
    <SiteSection sectionKey="pages">
      <SitePageEditor
        siteId={site.id}
        pagesEnabled={enabledModuleCodes.includes("PAGES")}
        permissions={permissions}
        languages={site.defaultLanguage ? {
          defaultLanguage: site.defaultLanguage,
          enabled: site.enabledLanguages ?? [site.defaultLanguage],
        } : undefined}
        mode="create"
      />
    </SiteSection>
  );
}
