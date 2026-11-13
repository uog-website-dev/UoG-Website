"use client";

import { useParams } from "next/navigation";
import { SitePostPreview } from "@/sites/site-post-preview";
import { SiteSection, useSiteAdmin } from "@/sites/site-admin-frame";

export default function PostPreviewPage() {
  const {site} = useSiteAdmin();
  const {postId} = useParams<{postId:string}>();
  return <SiteSection sectionKey="posts"><SitePostPreview key={`${site.id}:${postId}`} siteId={site.id} postId={postId} /></SiteSection>;
}
