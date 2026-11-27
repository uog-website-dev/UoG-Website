"use client";
import {SiteSection, useSiteAdmin} from "@/sites/site-admin-frame";
import {SiteEventSettingsPanel} from "@/sites/site-event-settings-panel";

export default function EventSettingsPage() {
  const {enabledModuleCodes} = useSiteAdmin();
  return (
    <SiteSection sectionKey="events">
      {enabledModuleCodes.includes("EVENTS") ? <SiteEventSettingsPanel /> : null}
    </SiteSection>
  );
}
