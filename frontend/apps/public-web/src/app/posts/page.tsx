import { Suspense } from "react";
import Typography from "@mui/material/Typography";

import { PublicPostsPage } from "@/public-posts";

export default function PostsPage() {
  return (
    <Suspense fallback={<Typography role="status">Loading published posts…</Typography>}>
      <PublicPostsPage />
    </Suspense>
  );
}
