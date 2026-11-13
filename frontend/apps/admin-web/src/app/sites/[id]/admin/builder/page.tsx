"use client";
import { SiteSection, useSiteAdmin } from "@/sites/site-admin-frame";
import { SitePagesPanel } from "@/sites/site-pages";

/** Site menu entry: pick any Page and open Visual Builder. */
export default function VisualBuilderChooserPage() {
  const { site, permissions, enabledModuleCodes } = useSiteAdmin();
  const pagesEnabled = enabledModuleCodes.includes("PAGES");
  const builderEnabled = enabledModuleCodes.includes("VISUAL_BUILDER");
  return (
    <SiteSection sectionKey="builder">
      <SitePagesPanel
        siteId={site.id}
        pagesEnabled={pagesEnabled}
        builderEnabled={builderEnabled}
        permissions={permissions}
        visualBuilderMode
        languages={site.defaultLanguage ? {
          defaultLanguage: site.defaultLanguage,
          enabled: site.enabledLanguages ?? [site.defaultLanguage],
        } : undefined}
      />
    </SiteSection>
  );
}
