/**
 * Edit an existing site.
 *
 * This route is a server component so the initial read happens on the server,
 * where the Keycloak access token lives. The token is never serialised into
 * the page — only the site payload is passed down to the client form, which
 * re-reads a fresh strong ETag for each conditional write.
 *
 * Failures are handled honestly:
 *   - 404            -> the platform's not-found screen (no dangling edit link)
 *   - 401 / 403      -> told to sign in, rather than shown an empty form
 *   - any other error -> surfaced with its correlation id so it is reportable
 */
import { notFound } from "next/navigation";

import { Breadcrumb } from "@/breadcrumb";
import { deserializeApiError } from "@/organizations/contract";
import { getSite } from "@/app/sites/actions";
import { EditSiteView } from "./edit-view";

export const metadata = { title: "Edit site" };

interface EditSitePageProps {
  params: Promise<{ id: string }>;
}

export default async function EditSitePage({ params }: EditSitePageProps) {
  const { id } = await params;
  const numericId = Number(id);
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(numericId)) {
    notFound();
  }

  const result = await getSite(numericId);

  if (!result.ok) {
    const error = deserializeApiError(result.error);
    if (error.status === 404) notFound();
    // For auth failures and unexpected errors, render the shared error state
    // inside the shell instead of a bare page, so navigation stays usable.
    return <EditSiteView error={error} site={null} />;
  }

  const { data, requestId } = result.data;
  return <EditSiteView requestId={requestId ?? undefined} site={data} />;
}
