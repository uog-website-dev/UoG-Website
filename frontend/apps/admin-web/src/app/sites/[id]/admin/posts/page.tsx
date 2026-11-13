"use client";

import { SitePostsPanel } from "@/sites/site-posts";
import { SiteSection, useSiteAdmin } from "@/sites/site-admin-frame";

export default function SitePostsAdminPage() {
  const { site, permissions, enabledModuleCodes } = useSiteAdmin();
  return (
    <SiteSection sectionKey="posts">
      <SitePostsPanel mediaEnabled={enabledModuleCodes.includes("MEDIA")} siteId={site.id} postsEnabled permissions={permissions} />
    </SiteSection>
  );
}
