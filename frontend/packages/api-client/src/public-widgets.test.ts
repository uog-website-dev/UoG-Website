import { describe, expect, it, vi } from "vitest";
import { fetchSiteWidgetData, SiteWidgetRequestError } from "./public-widgets";
import { documentsCopy } from "@uog/types";

const payload = { site: 7, source: "documents", results: [{ id: "doc-1", title: "Policy" }] };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("Site widget data adapter contract", () => {
  it("externalizes the Documents copy in English and Amharic", () => {
    expect(documentsCopy("en").menuLabel).toBe("Documents & Files");
    expect(documentsCopy("am-ET").menuLabel).toBe("ሰነዶች እና ፋይሎች");
  });
  it("sends the source, selected categories, limit and sort and validates the Site response", async () => {
    const fetchFn = vi.fn(async () => response(payload));
    await expect(fetchSiteWidgetData(fetchFn, "/widgets/", {
      source: "documents", document_categories: "cat-1,cat-2", limit: "4", document_sort: "title",
    }, 7)).resolves.toEqual(payload);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toContain("document_categories=cat-1%2Ccat-2");
    expect(String(url)).toContain("limit=4");
    expect((init as RequestInit).cache).toBe("no-store");
    expect((init as RequestInit).headers).toEqual({ Accept: "application/json" });
  });

  it("fails closed for another Site, another source, and malformed result rows", async () => {
    for (const body of [
      { ...payload, site: 8 }, { ...payload, source: "posts" }, { ...payload, results: [null] },
    ]) {
      await expect(fetchSiteWidgetData(async () => response(body), "/widgets/", { source: "documents" }, 7))
        .rejects.toMatchObject({ kind: "invalid_response" });
    }
  });

  it("normalizes unavailable, server and network failures for retryable UI handling", async () => {
    await expect(fetchSiteWidgetData(async () => response({}, 404), "/widgets/", { source: "documents" }, 7))
      .rejects.toMatchObject({ kind: "unavailable" });
    await expect(fetchSiteWidgetData(async () => response({}, 503), "/widgets/", { source: "documents" }, 7))
      .rejects.toMatchObject({ kind: "transport" });
    await expect(fetchSiteWidgetData(async () => { throw new Error("offline"); }, "/widgets/", { source: "documents" }, 7))
      .rejects.toBeInstanceOf(SiteWidgetRequestError);
  });

  it("rejects a non-JSON successful response", async () => {
    await expect(fetchSiteWidgetData(async () => new Response("<html>"), "/widgets/", { source: "documents" }, 7))
      .rejects.toMatchObject({ kind: "invalid_response" });
  });
});
