"use client";

import { SitePostsPanel } from "@/sites/site-posts";
import { SiteSection, useSiteAdmin } from "@/sites/site-admin-frame";

export default function SitePostsAdminPage() {
  const { site, permissions } = useSiteAdmin();
  return (
    <SiteSection sectionKey="posts">
      <SitePostsPanel siteId={site.id} postsEnabled permissions={permissions} />
    </SiteSection>
  );
}
