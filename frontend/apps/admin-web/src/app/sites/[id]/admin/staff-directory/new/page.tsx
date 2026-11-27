"use client";
import {SiteSection, useSiteAdmin} from "@/sites/site-admin-frame";
import {SiteStaffDirectoryNew} from "@/sites/site-staff-directory-list";

export default function NewStaffDirectoryPage() {
  const {enabledModuleCodes} = useSiteAdmin();
  return (
    <SiteSection sectionKey="staff-directory">
      {enabledModuleCodes.includes("STAFF_DIRECTORY") ? <SiteStaffDirectoryNew /> : null}
    </SiteSection>
  );
}
