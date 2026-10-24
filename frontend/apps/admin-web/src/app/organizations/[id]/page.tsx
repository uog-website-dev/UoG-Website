import { notFound } from "next/navigation";

import { getOrganization } from "@/app/organizations/actions";
import { OrganizationDetail } from "./organization-detail";

export const metadata = { title: "Organization details" };

interface OrganizationPageProps {
  params: Promise<{ id: string }>;
}

export default async function OrganizationPage({ params }: OrganizationPageProps) {
  const { id } = await params;
  const numericId = Number(id);
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(numericId)) {
    notFound();
  }

  const result = await getOrganization(numericId);
  if (!result.ok) {
    return <OrganizationDetail error={result.error} organization={null} />;
  }

  return <OrganizationDetail organization={result.data.data} />;
}
