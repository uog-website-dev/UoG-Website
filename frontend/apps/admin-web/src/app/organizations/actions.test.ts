import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/access-token", () => ({
  getAccessToken: vi.fn(),
}));

import { getAccessToken } from "@/access-token";
import {
  createOrganization,
  listOrganizations,
  moveOrganization,
} from "./actions";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("organization server actions", () => {
  it("keeps mock-created organizations visible to subsequent list reads", async () => {
    vi.stubEnv("API_MODE", "mock");

    const created = await createOrganization({
      code: "ACTION_PERSISTENCE_TEST",
      name: "Action Persistence Test Unit",
      organization_type: "COLLEGE",
    });
    expect(created.ok).toBe(true);

    const listed = await listOrganizations({ code: "ACTION_PERSISTENCE_TEST" });

    expect(listed).toMatchObject({
      ok: true,
      data: {
        count: 1,
        results: [{ code: "ACTION_PERSISTENCE_TEST", name: "Action Persistence Test Unit" }],
      },
    });
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it("moves with a fresh ETag and exposes the persisted parent in a later read", async () => {
    vi.stubEnv("API_MODE", "mock");

    const moved = await moveOrganization(3, 4);
    expect(moved).toMatchObject({
      ok: true,
      data: { data: { id: 3, parent: 4 } },
    });

    const listed = await listOrganizations({ code: "SOFTWARE_ENG" });
    expect(listed).toMatchObject({
      ok: true,
      data: { results: [{ id: 3, parent: 4 }] },
    });
    expect(getAccessToken).not.toHaveBeenCalled();
  });
});
