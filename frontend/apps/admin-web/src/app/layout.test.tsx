/**
 * The admin console's session gate: unauthenticated visitors must see the
 * sign-in screen and never the protected subtree, while an authenticated
 * session shows the verified identity and the sign-out control.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
  siteOrigin: "http://localhost",
}));

vi.mock("@/access-token", () => ({
  getAccessToken: vi.fn(async () => "access-token"),
}));

vi.mock("@/app/actions", () => ({
  signInWithKeycloak: vi.fn(),
  signOutFromSite: vi.fn(),
}));

const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT ${url}`);
});

let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => searchParams,
  redirect: (url: string) => redirect(url),
}));

import { getAccessToken } from "@/access-token";
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
  searchParams = new URLSearchParams();
});

describe("admin session gate", () => {
  it("shows the sign-in screen and renders none of the protected routes when signed out", async () => {
    const html = await renderLayout(null);

    expect(html).toContain("Sign in required");
    expect(html).toContain("Sign in with Keycloak");
    expect(html).not.toContain("protected-subtree");
    expect(html).not.toContain("Sign out");
    expect(html).not.toContain("Sign-in did not complete");
  });

  it("explains a failed sign-in callback on the sign-in screen instead of a server error", async () => {
    searchParams = new URLSearchParams({ error: "Configuration" });
    const html = await renderLayout(null);

    expect(html).toContain("Sign-in did not complete");
    expect(html).toContain("Sign in with Keycloak");
    expect(html).not.toContain("protected-subtree");
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

  it("sends an expired session to sign out and sign in again instead of rendering the console", async () => {
    vi.mocked(getAccessToken).mockResolvedValueOnce(null);
    await expect(renderLayout({ user: { email: "devuser@uog.et" } })).rejects.toThrow(
      "REDIRECT http://localhost/admin/api/session/expired",
    );
  });

  it("falls back to the session name when no email claim is present", async () => {
    const html = await renderLayout({
      user: { name: "Development User", email: null },
    });

    expect(html).toContain("Development User");
    expect(html).toContain("protected-subtree");
  });
});
