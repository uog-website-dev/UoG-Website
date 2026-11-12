import { describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "@uog/types";
import { createLiveMediaAdapter } from "./media";

const asset: MediaAsset = {
  id: "00000000-0000-4000-8000-000000000001", site: 11, display_name: "Campus", categories: ["Campus"], original_filename: "Campus.PNG",
  content_type: "image/png", detected_mime: "image/png", thumbnail_status: "NOT_GENERATED",
  thumbnail_url: null, processing_attempts: 0, processing_error_code: "",
  status: "READY", processing_state: "READY", byte_count: 123, checksum: "0".repeat(64),
  width: 2, height: 3, alt_text: "Campus", created_by: 1, updated_by: 1,
  created_at: "2026-11-11T12:00:00Z", updated_at: "2026-11-11T12:00:00Z",
};
function setup() {
  const fetchFn = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const data = new URL(String(input)).pathname.endsWith("/assets/")
      ? { count: 1, next: null, previous: null, results: [asset] } : asset;
    return new Response(JSON.stringify(data), { status: 200 });
  });
  return { fetchFn, adapter: createLiveMediaAdapter({ baseUrl: "http://backend/api", accessToken: "server-token", fetchFn }) };
}
describe("Site media typed client", () => {
  it("encodes literal filename filters and keeps page and status/type scope", async () => {
    const { fetchFn, adapter } = setup();
    await adapter.list(11, { search: "100%_campus & image", status: "READY", type: "image", content_type: "image/png", page: 2, page_size: 3, ordering: "original_filename" });
    const url = new URL(String(fetchFn.mock.calls[0]![0]));
    expect(url.pathname).toBe("/api/v1/sites/11/assets/");
    expect(Object.fromEntries(url.searchParams)).toEqual({ search: "100%_campus & image", status: "READY", type: "image", content_type: "image/png", page: "2", page_size: "3", ordering: "original_filename" });
    expect(url.toString()).not.toContain("server-token");
  });
  it("uses the ready-image contract for every picker and returns persisted accessibility metadata", async () => {
    const { fetchFn, adapter } = setup();
    const data = await adapter.readyImages(11, { search: "campus", page: 2 });
    expect(data.results).toEqual([asset]);
    expect(new URL(String(fetchFn.mock.calls[0]![0])).searchParams.get("ready_images")).toBe("true");
    expect(data.results[0]?.content_type).toBe("image/png");
    expect(data.results[0]?.alt_text).toBe("Campus");
    expect(data.results[0]?.thumbnail_status).toBe("NOT_GENERATED");
  });
  it("gets scoped details and patches only allowed metadata without pretending ETags exist", async () => {
    const { fetchFn, adapter } = setup();
    await adapter.detail(11, asset.id);
    await adapter.update(11, asset.id, { alt_text: "Accessible description" });
    expect(String(fetchFn.mock.calls[0]![0])).toContain(`/sites/11/assets/${asset.id}/`);
    const init = fetchFn.mock.calls[1]![1] as RequestInit;
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ alt_text: "Accessible description" });
    expect(new Headers(init.headers).get("If-Match")).toBeNull();
    expect(() => adapter.update(11, asset.id, { site: 22 } as never)).toThrow("Only media");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(() => adapter.list(0)).toThrow("positive Site");
  });
});

 it("uses scoped reference, removal and cleanup-status routes without storage paths", async () => {
    const { fetchFn, adapter } = setup();
    await adapter.inventory(11, asset.id);
    await adapter.remove(11, asset.id);
    await adapter.deletion(11, asset.id);
    expect(String(fetchFn.mock.calls[0]![0])).toContain(`/sites/11/assets/${asset.id}/references/`);
    expect((fetchFn.mock.calls[1]![1] as RequestInit).method).toBe("DELETE");
    expect(String(fetchFn.mock.calls[2]![0])).toContain(`/sites/11/assets/${asset.id}/deletion/`);
  });

it("sends editable media names and category labels through the scoped metadata route", async () => {
  const { fetchFn, adapter } = setup();
  await adapter.update(11, asset.id, { display_name: "Campus festival", categories: ["Events"], alt_text: "Festival guests" });
  const request = fetchFn.mock.calls[0]![1] as RequestInit;
  expect(request.method).toBe("PATCH");
  expect(JSON.parse(String(request.body))).toEqual({ display_name: "Campus festival", categories: ["Events"], alt_text: "Festival guests" });
  expect(String(fetchFn.mock.calls[0]![0])).toContain(`/sites/11/assets/${asset.id}/`);
});
