"use client";
import { useParams } from "next/navigation";
import { SiteSection, useSiteAdmin } from "@/sites/site-admin-frame";
import { SiteEventEditorPage } from "@/sites/site-event-editor";

export default function PreviewEventPage() {
  const { enabledModuleCodes, site } = useSiteAdmin();
  const params = useParams<{ eventId: string }>();
  return (
    <SiteSection sectionKey="events">
      {enabledModuleCodes.includes("EVENTS") ? (
        <SiteEventEditorPage siteId={site.id} mode="preview" eventId={String(params.eventId)} />
      ) : null}
    </SiteSection>
  );
}
