"use client";
import { MediaLibrary } from "@/sites/media-library";
import { SiteSection, useSiteAdmin } from "@/sites/site-admin-frame";
export default function MediaPage() {
  const { site, permissions } = useSiteAdmin();
  return <SiteSection sectionKey="media"><MediaLibrary key={site.id} siteId={site.id} canUpload={permissions.includes("content.media.upload")} canDelete={permissions.includes("content.media.delete")} /></SiteSection>;
}
