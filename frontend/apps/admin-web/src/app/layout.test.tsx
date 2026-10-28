/**
 * The admin console's session gate: unauthenticated visitors must see the
 * sign-in screen and never the protected subtree, while an authenticated
 * session shows the verified identity and the sign-out control.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/app/actions", () => ({
  signInWithKeycloak: vi.fn(),
  signOutFromSite: vi.fn(),
}));

import { auth } from "@/auth";

import AdminLayout from "./layout";

const authMock = vi.mocked(auth);

const protectedMarker = <div data-testid="protected-subtree" />;

async function renderLayout(session: unknown): Promise<string> {
  authMock.mockResolvedValue(session as never);
  return renderToStaticMarkup(await AdminLayout({ children: protectedMarker }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("admin session gate", () => {
  it("shows the sign-in screen and renders none of the protected routes when signed out", async () => {
    const html = await renderLayout(null);

    expect(html).toContain("Sign in required");
    expect(html).toContain("Sign in with Keycloak");
    expect(html).not.toContain("protected-subtree");
    expect(html).not.toContain("Sign out");
  });

  it("renders the protected routes and the verified identity when signed in", async () => {
    const html = await renderLayout({
      user: { name: "Development User", email: "devuser@uog.et" },
    });

    expect(html).toContain("protected-subtree");
    expect(html).toContain("devuser@uog.et");
    expect(html).toContain("Sign out");
    expect(html).not.toContain("Sign in required");
  });

  it("falls back to the session name when no email claim is present", async () => {
    const html = await renderLayout({
      user: { name: "Development User", email: null },
    });

    expect(html).toContain("Development User");
    expect(html).toContain("protected-subtree");
  });
});
