"use client";
import {SiteSection} from "@/sites/site-admin-frame";
import {SiteAppearancePanel} from "@/sites/site-appearance";
export default function AppearancePage() {
  return <SiteSection sectionKey="appearance"><SiteAppearancePanel/></SiteSection>;
}
