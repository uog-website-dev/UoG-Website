import { PublicPostPage } from "@/public-posts";

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <PublicPostPage slug={slug} />;
}
