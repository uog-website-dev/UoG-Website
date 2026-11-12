import { NextRequest, NextResponse } from "next/server";
import { getAccessToken } from "@/access-token";

export const runtime = "nodejs";

/** Stream bytes to Django; the bearer token never enters the browser. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    if (!origin || new URL(origin).host !== host) return NextResponse.json({ detail: "Invalid request origin." }, { status: 403 });
  } catch { return NextResponse.json({ detail: "Invalid request origin." }, { status: 403 }); }
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ detail: "Sign in to upload." }, { status: 401 });
  const { id } = await context.params;
  if (!/^[1-9][0-9]*$/.test(id)) return NextResponse.json({ detail: "Invalid Site." }, { status: 400 });
  const url = new URL(`${process.env.API_BASE_URL ?? "http://backend:8000/api"}/v1/sites/${id}/assets/upload/`);
  url.searchParams.set("filename", request.nextUrl.searchParams.get("filename") ?? "");
  const headers = new Headers({ Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" });
  for (const name of ["content-length", "idempotency-key"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const response = await fetch(url, { method: "POST", headers, body: request.body, duplex: "half", cache: "no-store", signal: request.signal } as RequestInit & { duplex: string });
    return new NextResponse(response.body, { status: response.status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ detail: "Upload interrupted. Retry the same file." }, { status: 503 });
  }
}
