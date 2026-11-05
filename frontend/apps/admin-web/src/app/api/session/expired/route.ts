import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { getAccessToken } from "@/access-token";
import { signIn, signOut, siteOrigin } from "@/auth";
import { safeReturnTo } from "@/session-expiry";
import { getSessionToken } from "@/session-jwt";

export const dynamic = "force-dynamic";

/**
 * Signs out a session that can no longer reach the API and starts a new
 * Keycloak sign-in that comes back to `returnTo`.
 *
 * A session that still has a usable token is left alone and sent straight
 * back, so a link to this route cannot sign anyone out.
 */
export async function GET(request: NextRequest) {
  const destination = `${siteOrigin}${safeReturnTo(request.nextUrl.searchParams.get("returnTo"))}`;

  if (await getSessionToken()) {
    if (await getAccessToken()) redirect(destination);
    await signOut({ redirect: false });
  }
  await signIn("keycloak", { redirectTo: destination });
}
