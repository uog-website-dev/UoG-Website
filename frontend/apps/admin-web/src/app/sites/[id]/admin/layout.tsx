/**
 * Site administration for one Site in the shared console.
 *
 * The backend site list is already limited to sites this user may view.
 * Content sections are chosen from that Site's enabled module codes and
 * the permissions reported for this Site. A failed read hides content
 * sections rather than showing another Site's modules.
 */
import { notFound } from "next/navigation";

import { getEffectivePermissions } from "@/access-control";
import {
  getSite,
  listAllSites,
  listSiteModuleAssignments,
} from "@/app/sites/actions";
import {
  accessibleSiteOptions,
  enabledModuleCodes,
} from "@/sites/site-admin";
import { SiteAdminDenied, SiteAdminFrame } from "@/sites/site-admin-frame";

export const metadata = { title: "Site administration" };

interface SiteAdminLayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

export default async function SiteAdminLayout({ children, params }: SiteAdminLayoutProps) {
  const { id } = await params;
  const numericId = Number(id);
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(numericId)) {
    notFound();
  }

  const [siteResult, siteList] = await Promise.all([
    getSite(numericId),
    listAllSites(),
  ]);
  const choices = accessibleSiteOptions(
    (siteList.ok ? siteList.data : []).map((site) => ({
      id: site.id,
      name: site.name,
      code: site.code,
      status: site.status,
    })),
  );

  if (!siteResult.ok) {
    return <SiteAdminDenied sites={choices} />;
  }

  const site = siteResult.data.data;
  const [assignments, permissions] = await Promise.all([
    listSiteModuleAssignments(site.id),
    getEffectivePermissions(site.id),
  ]);
  const current = {
    id: site.id,
    name: site.name,
    code: site.code,
    status: site.status,
  };
  const options = choices.some((choice) => choice.id === site.id)
    ? choices
    : [current, ...choices];

  return (
    <SiteAdminFrame
      site={current}
      sites={options}
      enabledModuleCodes={assignments.ok ? enabledModuleCodes(assignments.data.results, site.id) : []}
      permissions={permissions}
    >
      {children}
    </SiteAdminFrame>
  );
}
