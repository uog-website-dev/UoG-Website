import { Suspense } from "react";
import Typography from "@mui/material/Typography";
import { PublicDocumentsPage } from "@/public-documents";

export default function DocumentsPage() {
  return <Suspense fallback={<Typography role="status">Loading documents…</Typography>}>
    <PublicDocumentsPage />
  </Suspense>;
}
