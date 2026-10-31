/**
 * Site detail route.
 *
 * The route stays a thin server component (metadata + chrome) while the read
 * runs through the `getSite` server action, so the Keycloak access token
 * never reaches the browser. Loading, not-found, access-denied and error
 * states are owned by the view — see `src/sites/site-detail.tsx`.
 */
import { notFound } from "next/navigation";

import { getEffectivePermissions } from "@/access-control";
import { getSite } from "@/app/sites/actions";
import { SiteDetail } from "@/sites/site-detail";

export const metadata = { title: "Site details" };

interface SitePageProps {
  params: Promise<{ id: string }>;
}

export default async function SitePage({ params }: SitePageProps) {
  const { id } = await params;
  const numericId = Number(id);
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(numericId)) {
    notFound();
  }

  const result = await getSite(numericId);
  if (!result.ok) {
    return <SiteDetail error={result.error} site={null} />;
  }

  const permissions = await getEffectivePermissions(numericId);
  return <SiteDetail site={result.data.data} permissions={permissions} />;
}
