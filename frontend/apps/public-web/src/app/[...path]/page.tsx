import { PublicPathPage } from "@/public-page";
import type { Metadata } from "next";
import { pageRouteMetadata } from "@/public-metadata";

export async function generateMetadata({ params }: { params: Promise<{ path: string[] }> }): Promise<Metadata> {
  const { path } = await params;
  if (!path.length || path.some((part) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(part))) return {};
  return pageRouteMetadata(`/${path.join("/")}`);
}

export default async function SitePage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  return <PublicPathPage segments={path} />;
}
