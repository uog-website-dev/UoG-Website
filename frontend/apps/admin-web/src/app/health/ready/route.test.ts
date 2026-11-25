import {afterEach, describe, expect, it, vi} from "vitest";

const upstream = vi.fn();
vi.mock("@/performance/server-fetch", () => ({serverApiFetch: (...args: unknown[]) => upstream(...args)}));

import {GET} from "./route";

describe("admin readiness proxy", () => {
  const previous = process.env.API_BASE_URL;
  afterEach(() => {
    vi.clearAllMocks();
    if (previous === undefined) delete process.env.API_BASE_URL;
    else process.env.API_BASE_URL = previous;
  });

  it("proxies readiness to Django using the server API origin", async () => {
    process.env.API_BASE_URL = "http://backend:8000/api";
    upstream.mockResolvedValue(Response.json({status: "ok", checks: {database: {status: "ok"}}}));
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({status: "ok"});
    expect(upstream).toHaveBeenCalledWith("http://backend:8000/health/ready", expect.objectContaining({cache: "no-store"}));
  });

  it("returns a controlled unavailable response when Django cannot be reached", async () => {
    upstream.mockRejectedValue(new Error("internal network detail"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({status: "unavailable"});
  });
});
