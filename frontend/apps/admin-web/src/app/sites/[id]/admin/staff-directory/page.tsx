"use client";
import {SiteSection, useSiteAdmin} from "@/sites/site-admin-frame";
import {SiteStaffDirectoryList} from "@/sites/site-staff-directory-list";

export default function StaffDirectoryPage() {
  const {enabledModuleCodes} = useSiteAdmin();
  return (
    <SiteSection sectionKey="staff-directory">
      {enabledModuleCodes.includes("STAFF_DIRECTORY") ? <SiteStaffDirectoryList /> : null}
    </SiteSection>
  );
}
