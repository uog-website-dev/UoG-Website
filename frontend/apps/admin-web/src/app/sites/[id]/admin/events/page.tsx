"use client";
import {SiteSection, useSiteAdmin} from "@/sites/site-admin-frame";
import {SiteEventsList} from "@/sites/site-events-list";

export default function EventsPage() {
  const {enabledModuleCodes} = useSiteAdmin();
  return (
    <SiteSection sectionKey="events">
      {enabledModuleCodes.includes("EVENTS") ? <SiteEventsList /> : null}
    </SiteSection>
  );
}
