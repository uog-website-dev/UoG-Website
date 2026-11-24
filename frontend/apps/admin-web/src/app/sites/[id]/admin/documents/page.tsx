"use client";
import {SiteSection,useSiteAdmin} from "@/sites/site-admin-frame";
import {SiteDocuments} from "@/sites/site-documents";
export default function DocumentsPage(){const {enabledModuleCodes}=useSiteAdmin();return <SiteSection sectionKey="documents">{enabledModuleCodes.includes("DOCUMENTS")?<SiteDocuments/>:null}</SiteSection>}
