"use server";

/**
 * Session actions for the admin console header.
 *
 * Auth.js v5 has no GET endpoint for a provider sign-in: `/api/auth/signin/<provider>`
 * must be a POST (a plain link to it fails with "Unsupported action"). The
 * server-side `signIn()` helper performs that POST internally — including
 * CSRF handling — and redirects the browser to Keycloak.
 */
import { redirect } from "next/navigation";

import { issuer, signIn, signOut, siteOrigin } from "@/auth";
import { getSessionToken } from "@/session-jwt";

const keycloakLogoutUrl = `${issuer}/protocol/openid-connect/logout`;
const clientId = process.env.KEYCLOAK_CLIENT_ID ?? "admin-web";

export async function signInWithKeycloak() {
  await signIn("keycloak", { redirectTo: `${siteOrigin}/admin` });
}

export async function signOutFromSite() {
  // Read the Keycloak ID token before the local session is destroyed; Keycloak
  // needs it to identify (and terminate) the federated session.
  const session = await getSessionToken();
  const idToken = typeof session?.idToken === "string" ? session.idToken : null;

  // Clears the Auth.js session cookie.
  await signOut({ redirect: false });

  // Also end the Keycloak SSO session. Without this step the next sign-in is
  // answered silently from the still-active IdP session, so signing out and
  // back in never shows a login form.
  const logout = new URL(keycloakLogoutUrl);
  if (idToken) logout.searchParams.set("id_token_hint", idToken);
  else logout.searchParams.set("client_id", clientId);
  logout.searchParams.set("post_logout_redirect_uri", `${siteOrigin}/admin/`);
  redirect(logout.toString());
}
