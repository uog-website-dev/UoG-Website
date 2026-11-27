"use client";
import {SiteSection, useSiteAdmin} from "@/sites/site-admin-frame";
import {SiteStaffDirectorySettingsPanel} from "@/sites/site-staff-directory-settings-panel";

export default function StaffDirectorySettingsPage() {
  const {enabledModuleCodes} = useSiteAdmin();
  return (
    <SiteSection sectionKey="staff-directory">
      {enabledModuleCodes.includes("STAFF_DIRECTORY") ? <SiteStaffDirectorySettingsPanel /> : null}
    </SiteSection>
  );
}
