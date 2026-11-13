"use client";
import { useParams } from "next/navigation";
import { SiteSection, useSiteAdmin } from "@/sites/site-admin-frame";
import { VisualBuilder } from "@/sites/visual-builder";

/** Canvas for one Page. Nav highlight uses the Visual Builder section. */
export default function VisualBuilderPage() {
  const { site, permissions, enabledModuleCodes } = useSiteAdmin();
  const { pageId } = useParams<{ pageId: string }>();
  const builderEnabled = enabledModuleCodes.includes("VISUAL_BUILDER");
  return (
    <SiteSection sectionKey="builder">
      <VisualBuilder
        siteId={site.id}
        siteName={site.name}
        pageId={pageId}
        builderEnabled={builderEnabled}
        permissions={permissions}
      />
    </SiteSection>
  );
}
