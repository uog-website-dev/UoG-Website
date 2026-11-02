import { PublicPathPage } from "@/public-page";

export default async function SitePage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  return <PublicPathPage segments={path} />;
}
