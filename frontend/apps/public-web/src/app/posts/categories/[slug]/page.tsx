import { Suspense } from "react";
import { PublicPostsPage } from "@/public-posts";

export default async function CategoryArchive({ params }: { params: Promise<{slug:string}> }) {
  const {slug} = await params;
  return <Suspense fallback={<p role="status">Loading category...</p>}><PublicPostsPage key={slug} archiveSlug={slug} /></Suspense>;
}
