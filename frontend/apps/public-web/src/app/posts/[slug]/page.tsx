import { PublicPostPage } from "@/public-posts";
import type { Metadata } from "next";
import { postRouteMetadata, publicPostPayload } from "@/public-metadata";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return postRouteMetadata(slug);
}

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const payload = await publicPostPayload(slug);
  return <PublicPostPage slug={slug} initialPayload={payload} />;
}
