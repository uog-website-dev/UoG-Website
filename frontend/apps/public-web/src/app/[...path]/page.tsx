import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { websitePathFromRedirect } from "@uog/ui/public-site";
import { PublicPathPage } from "@/public-page";
import { pageRouteMetadata, publicPagePayload } from "@/public-metadata";

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
  const route = `/${path.join("/")}`;
  const payload = await publicPagePayload(route);
  if (payload && (payload.status === 308 || payload.status === 301 || payload.status === 302 || payload.status === 307)) {
    const next = websitePathFromRedirect(payload.location);
    if (next && next !== route) redirect(next);
  }
  return <PublicPathPage key={route} segments={path} initialPayload={payload} />;
}
