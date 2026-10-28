/**
 * Per-Site module configuration route.
 *
 * Thin server component: validates the id, reads the site through the
 * `getSite` server action (the Keycloak access token stays server-side) and
 * hands the screen to `SiteModules`, which owns loading, error and empty
 * states plus the enable/disable/settings controls.
 */
import { notFound } from "next/navigation";

import { getSite } from "@/app/sites/actions";
import { SiteModules } from "@/sites/site-modules";

export const metadata = { title: "Site modules" };

interface SiteModulesPageProps {
  params: Promise<{ id: string }>;
}

export default async function SiteModulesPage({ params }: SiteModulesPageProps) {
  const { id } = await params;
  const numericId = Number(id);
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(numericId)) {
    notFound();
  }

  const result = await getSite(numericId);
  if (!result.ok) {
    return <SiteModules error={result.error} site={null} />;
  }

  return <SiteModules site={result.data.data} />;
}
