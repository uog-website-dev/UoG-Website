"use client";

import { SiteHomepagePanel } from "@/sites/site-homepage";
import { SiteSection } from "@/sites/site-admin-frame";

export default function SiteHomepageAdminPage() {
  return (
    <SiteSection sectionKey="homepage">
      <SiteHomepagePanel />
    </SiteSection>
  );
}
