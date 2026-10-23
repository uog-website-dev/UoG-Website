/**
 * The Next.js base path of the admin console.
 *
 * nginx serves the console under `/admin`, so Next.js prefixes every route
 * — including the Auth.js route handler — with it. Next.js strips that
 * prefix from the request path before a route handler runs, which is why the
 * handler restores it again (see `app/api/auth/[...nextauth]/route.ts`).
 */
export const APP_BASE_PATH = "/admin";
