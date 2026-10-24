import { describe, expect, it } from "vitest";

import {
  draftFromQuery,
  draftToQuery,
  parseListQuery,
  queryToSearchParams,
} from "./list-query";

describe("organization list URL query contract", () => {
  it("parses approved filters, page, and server ordering", () => {
    const query = parseListQuery(
      new URLSearchParams(
        "search=college&name=informatics&code=ci&type=COLLEGE&parent=7&status=ACTIVE&page=3&ordering=-updated_at",
      ),
    );

    expect(query).toEqual({
      search: "college",
      name: "informatics",
      code: "CI",
      type: "COLLEGE",
      parent: 7,
      status: "ACTIVE",
      page: 3,
      ordering: "-updated_at",
    });
  });

  it("drops invalid and repeated filter values rather than forwarding them", () => {
    const query = parseListQuery(
      new URLSearchParams("name=one&name=two&code=not%20valid&page=0&ordering=metadata"),
    );

    expect(query).toEqual({});
  });

  it("round-trips filter drafts and shareable query parameters", () => {
    const draft = draftFromQuery({
      search: "informatics",
      name: "college",
      code: "CI",
      type: "COLLEGE",
      parent: "null",
      status: "ACTIVE",
    });
    const query = draftToQuery(draft);
    const params = queryToSearchParams({ ...query, page: 2, ordering: "name" });

    expect(query).toEqual({
      search: "informatics",
      name: "college",
      code: "CI",
      type: "COLLEGE",
      parent: "null",
      status: "ACTIVE",
    });
    expect(params.toString()).toBe(
      "search=informatics&name=college&code=CI&type=COLLEGE&parent=null&status=ACTIVE&page=2&ordering=name",
    );
  });
});
