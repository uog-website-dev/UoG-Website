import { Suspense } from "react";
import type { Metadata } from "next";
import { PublicEventDetailPage } from "@/public-event-detail";
import { eventRouteMetadata, publicEventPayload } from "@/public-metadata";
import type { SiteEventRecord } from "@uog/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return eventRouteMetadata(slug);
}

function seedEvent(payload: Awaited<ReturnType<typeof publicEventPayload>>): SiteEventRecord | null {
  if (!payload || payload.status !== 200 || !payload.body || typeof payload.body !== "object") return null;
  const row = payload.body as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.title !== "string" || typeof row.slug !== "string") return null;
  if ("organizer_email" in row || "organizer_phone" in row) return null;
  return row as unknown as SiteEventRecord;
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const payload = await publicEventPayload(slug);
  const initialEvent = seedEvent(payload);
  return (
    <Suspense fallback={<p role="status">Loading Event…</p>}>
      <PublicEventDetailPage slug={slug} initialEvent={initialEvent} />
    </Suspense>
  );
}
