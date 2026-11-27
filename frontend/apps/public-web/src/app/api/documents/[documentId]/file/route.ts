import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unavailable(status: number, detail = "Document file unavailable.") {
  const response = NextResponse.json({ detail }, { status });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  const host = request.headers.get("host") ?? "";
  if (!UUID.test(documentId) || !/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host)) {
    return unavailable(404, "Document unavailable.");
  }
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  const session = secret ? await getToken({ req: request, secret }) : null;
  const accessToken = typeof session?.accessToken === "string" ? session.accessToken : null;
  const headers = new Headers({ Accept: "application/octet-stream", Host: host });
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const base = process.env.API_BASE_URL ?? "http://backend:8000/api";
  const inline = request.nextUrl.searchParams.get("inline") === "1" ? "?inline=1" : "";
  try {
    const response = await fetch(`${base}/v1/site-context/documents/${documentId}/file/${inline}`, {
      headers, cache: "no-store", redirect: "manual",
    });
    const safeHeaders = new Headers({
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Frame-Options": "SAMEORIGIN",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Disposition": response.headers.get("content-disposition") ?? "attachment",
    });
    const contentType = response.headers.get("content-type");
    if (contentType) safeHeaders.set("Content-Type", contentType);
    if (!response.ok) return unavailable(response.status, response.status === 401 ? "Sign in to download this document." : "Document file unavailable.");
    return new Response(response.body, { status: 200, headers: safeHeaders });
  } catch {
    return unavailable(502);
  }
}
