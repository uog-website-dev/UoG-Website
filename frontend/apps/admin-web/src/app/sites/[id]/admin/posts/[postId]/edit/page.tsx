"use client";

import { useParams } from "next/navigation";

import { SitePostEditor } from "@/sites/site-post-editor";
import { SiteSection, useSiteAdmin } from "@/sites/site-admin-frame";

export default function SitePostEditPage() {
  const { site, permissions, enabledModuleCodes } = useSiteAdmin();
  const { postId } = useParams<{ postId: string }>();
  return (
    <SiteSection sectionKey="posts">
      <SitePostEditor
        siteId={site.id}
        postsEnabled={enabledModuleCodes.includes("POSTS")}
        mediaEnabled={enabledModuleCodes.includes("MEDIA")}
        permissions={permissions}
        mode="edit"
        postId={postId}
      />
    </SiteSection>
  );
}
