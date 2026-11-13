"use client";

import { useSearchParams } from "next/navigation";

import { SitePagesPanel } from "@/sites/site-pages";
import { SiteSection, useSiteAdmin } from "@/sites/site-admin-frame";

export default function SitePagesAdminPage() {
  const { site, permissions, enabledModuleCodes } = useSiteAdmin();
  const startCreate = useSearchParams().get("create") === "1";
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
        startCreate={startCreate}
        onCreateStarted={() => window.history.replaceState(null, "", window.location.pathname)}
      />
    </SiteSection>
  );
}
