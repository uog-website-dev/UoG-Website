"use client";
import {SiteSection, useSiteAdmin} from "@/sites/site-admin-frame";
import {SiteEventsNew} from "@/sites/site-events-list";

export default function NewEventPage() {
  const {enabledModuleCodes} = useSiteAdmin();
  return (
    <SiteSection sectionKey="events">
      {enabledModuleCodes.includes("EVENTS") ? <SiteEventsNew /> : null}
    </SiteSection>
  );
}
