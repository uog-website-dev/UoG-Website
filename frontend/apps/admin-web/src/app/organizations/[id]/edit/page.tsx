/**
 * Edit an existing organization unit.
 *
 * This route is a server component so the initial read (and the strong ETag
 * required for the conditional PATCH) happens on the server, where the
 * Keycloak access token lives. The token is never serialised into the page —
 * only the organization payload and the ETag string are passed down to the
 * client form.
 *
 * Failures are handled honestly:
 *   - 404            -> the platform's not-found screen (no dangling edit link)
 *   - 401 / 403      -> told to sign in, rather than shown an empty form
 *   - any other error -> surfaced with its correlation id so it is reportable
 */
import { notFound } from "next/navigation";

import { Breadcrumb } from "@/breadcrumb";
import { deserializeApiError, unwrap } from "@/organizations/contract";
import { getOrganization } from "@/app/organizations/actions";
import { EditOrganizationView } from "./edit-view";

export const metadata = { title: "Edit organization" };

interface EditOrganizationPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditOrganizationPage({
  params,
}: EditOrganizationPageProps) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    notFound();
  }

  const result = await getOrganization(numericId);

  if (!result.ok) {
    const error = deserializeApiError(result.error);
    if (error.status === 404) notFound();
    // For auth failures and unexpected errors, render the shared error state
    // inside the shell instead of a bare page, so navigation stays usable.
    return <EditOrganizationView error={error} organization={null} etag={null} />;
  }

  const { data, etag, requestId } = result.data;
  return (
    <EditOrganizationView
      organization={data}
      etag={etag}
      requestId={requestId ?? undefined}
    />
  );
}
