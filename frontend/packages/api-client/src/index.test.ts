import { describe, expect, it, vi } from "vitest";

import { ApiError, createApiClient } from "./index";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createApiClient", () => {
  it("performs GET requests against the configured base URL", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ status: "ok" }));
    const client = createApiClient({
      baseUrl: "http://backend:8000/api/",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const result = await client.get<{ status: string }>("/pages/");

    expect(result).toEqual({ status: "ok" });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://backend:8000/api/pages/");
    expect(init.method).toBeUndefined();
    expect((init.headers as Record<string, string>).Accept).toBe("application/json");
  });

  it("sends the access token as a Bearer header when configured", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const client = createApiClient({
      baseUrl: "http://backend:8000/api",
      accessToken: "keycloak-token",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await client.get("/me/");

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer keycloak-token",
    );
  });

  it("omits the Authorization header when no token is configured", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const client = createApiClient({
      baseUrl: "http://backend:8000/api",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await client.get("/pages/");

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("serialises POST bodies as JSON", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const client = createApiClient({
      baseUrl: "http://backend:8000/api",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await client.post("/pages/", { title: "Hello" });

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ title: "Hello" }));
  });

  it("throws ApiError with the HTTP status on failures", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ detail: "nope" }, 404));
    const client = createApiClient({
      baseUrl: "http://backend:8000/api",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await expect(client.get("/missing/")).rejects.toThrowError(ApiError);
  });
});
