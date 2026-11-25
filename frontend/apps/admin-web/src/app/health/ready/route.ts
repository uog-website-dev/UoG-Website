import {serverApiFetch} from "@/performance/server-fetch";

/**
 * Same-origin readiness proxy for developers opening the admin app directly
 * on port 3001. Behind nginx, /health/ready still goes straight to Django;
 * this route is reached at /admin/health/ready through the admin app instead.
 */
export async function GET() {
  const apiBase = process.env.API_BASE_URL ?? "http://backend:8000/api";
  const backendRoot = apiBase.replace(/\/api\/?$/, "").replace(/\/$/, "");
  try {
    const upstream = await serverApiFetch(`${backendRoot}/health/ready`, {
      method: "GET",
      headers: {Accept: "application/json"},
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({status: "unavailable"}, {
      status: 503,
      headers: {"Cache-Control": "no-store"},
    });
  }
}
