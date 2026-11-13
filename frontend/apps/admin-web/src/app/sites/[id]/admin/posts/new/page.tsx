"use client";

import { SitePostEditor } from "@/sites/site-post-editor";
import { SiteSection, useSiteAdmin } from "@/sites/site-admin-frame";

export default function SitePostCreatePage() {
  const { site, permissions, enabledModuleCodes } = useSiteAdmin();
  return (
    <SiteSection sectionKey="posts">
      <SitePostEditor
        siteId={site.id}
        postsEnabled={enabledModuleCodes.includes("POSTS")}
        mediaEnabled={enabledModuleCodes.includes("MEDIA")}
        permissions={permissions}
        mode="create"
      />
    </SiteSection>
  );
}
