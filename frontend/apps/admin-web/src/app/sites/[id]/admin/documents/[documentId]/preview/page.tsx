"use client";

import { useParams } from "next/navigation";
import { Alert, Box, Button, Typography } from "@mui/material";
import { SiteSection, useSiteAdmin } from "@/sites/site-admin-frame";
import { getSiteDocument } from "@/app/sites/document-actions";
import { unwrap } from "@/organizations/contract";
import { useSiteQuery } from "@/data/query-cache";
import { APP_BASE_PATH } from "@/base-path";

export default function DocumentPreviewPage() {
  const { site, permissions } = useSiteAdmin();
  const { documentId } = useParams<{ documentId: string }>();
  const canView = permissions.includes("content.documents.view");
  const result = useSiteQuery(
    site.id,
    "document-preview",
    { id: documentId },
    async () => unwrap(await getSiteDocument(site.id, documentId)),
    { enabled: canView },
  );
  const fileUrl = `${APP_BASE_PATH}/api/sites/${site.id}/documents/${documentId}/file`;

  return (
    <SiteSection sectionKey="documents">
      <Box sx={{ p: 3, display: "grid", gap: 2 }}>
        <Typography variant="h4">Document Preview</Typography>
        {!canView && <Alert severity="error">This document is unavailable.</Alert>}
        {canView && result.error && <Alert severity="error">This document is unavailable.</Alert>}
        {canView && result.data && <>
          <Typography variant="h6">{result.data.title}</Typography>
          <Typography>{result.data.description.replace(/<[^>]*>/g, "")}</Typography>
          {result.data.file_type === "application/pdf"
            ? <iframe title={`Preview ${result.data.original_filename}`} src={`${fileUrl}?inline=1`} style={{ width: "100%", height: "70vh", border: "1px solid #ccc" }} />
            : <Typography>Inline preview is not available for this file type.</Typography>}
          <Button target="_blank" rel="noreferrer" href={fileUrl}>Download {result.data.original_filename}</Button>
        </>}
      </Box>
    </SiteSection>
  );
}
