import { Suspense } from "react";
import Typography from "@mui/material/Typography";
import { PublicEventsPage } from "@/public-events";

export default function EventsPage() {
  return (
    <Suspense fallback={<Typography role="status">Loading events…</Typography>}>
      <PublicEventsPage />
    </Suspense>
  );
}
