import { PublicEventDetailPage } from "@/public-events";

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <PublicEventDetailPage slug={slug} />;
}
