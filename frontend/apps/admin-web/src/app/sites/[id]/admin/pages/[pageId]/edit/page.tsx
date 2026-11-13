"use client";

import { useParams } from "next/navigation";

import { SitePageEditor } from "@/sites/site-page-editor";
import { SiteSection, useSiteAdmin } from "@/sites/site-admin-frame";

export default function SitePageEditPage() {
  const { site, permissions, enabledModuleCodes } = useSiteAdmin();
  const { pageId } = useParams<{ pageId: string }>();
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
        mode="edit"
        pageId={pageId}
      />
    </SiteSection>
  );
}
