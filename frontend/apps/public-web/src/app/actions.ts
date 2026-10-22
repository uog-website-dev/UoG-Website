"use server";

/**
 * Session actions for the public site header.
 *
 * Auth.js v5 has no GET endpoint for a provider sign-in: `/api/auth/signin/<provider>`
 * must be a POST (a plain link to it fails with "Unsupported action"). The
 * server-side `signIn()` helper performs that POST internally — including
 * CSRF handling — and redirects the browser to Keycloak.
 */
import { signIn, signOut, siteOrigin } from "@/auth";

export async function signInWithKeycloak() {
  await signIn("keycloak", { redirectTo: siteOrigin });
}

export async function signOutFromSite() {
  await signOut({ redirectTo: siteOrigin });
}
