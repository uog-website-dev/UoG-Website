import { handlers } from "@/auth";
import { APP_BASE_PATH } from "@/base-path";
import { NextRequest } from "next/server";

/**
 * Auth.js is configured with the base path `/admin/api/auth`, because the
 * OAuth redirect URI has to point at the route that nginx exposes under
 * `/admin/`. Next.js however removes the `/admin` prefix from the request
 * path before the route handler is invoked, so Auth.js would no longer
 * recognise the action and would answer with "Cannot parse action at ...".
 * Restoring the prefix here keeps action parsing and the redirect URI in
 * sync with the routes that are actually served.
 */
function withBasePath(request: NextRequest): NextRequest {
  const url = new URL(request.url);
  const marker = "/api/auth/";
  const index = url.pathname.indexOf(marker);

  if (index === -1) return request;

  url.pathname = `${APP_BASE_PATH}${url.pathname.slice(index)}`;
  return new NextRequest(url, request);
}

export const GET = (request: NextRequest) => handlers.GET(withBasePath(request));
export const POST = (request: NextRequest) => handlers.POST(withBasePath(request));
