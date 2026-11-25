import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pathname = vi.fn(() => "/");
let workspaceResponse: unknown;

beforeEach(() => {
  pathname.mockReturnValue("/");
  workspaceResponse = {
    schemaVersion: 1,
    version: "fixture-v1",
    platformPermissions: ["platform.dashboard.view", "platform.organizations.view", "sites.view"],
    site: null,
  };
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => workspaceResponse,
  })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

vi.mock("next/navigation", () => ({
  usePathname: () => pathname(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { AdminShell } from "@/admin-shell";

describe("AdminShell", () => {
  it("renders the console chrome around the page content", () => {
    render(
      <AdminShell identity="test-shell" actions={<span>Sign in</span>}>
        <p>Page content</p>
      </AdminShell>,
    );

    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByText("Page content")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Skip to main content" }),
    ).toBeTruthy();
    expect(screen.getByText("Sign in")).toBeTruthy();
    expect(
      screen.getAllByRole("navigation", { name: "Admin sections" }).length,
    ).toBe(1);
  });

  it("pins the footer and header outside the scroll isolation: main owns the scrolling column", () => {
    render(
      <AdminShell identity="test-shell">
        <p>Page content</p>
      </AdminShell>,
    );

    // The footer lives inside the scrolling content column (so it is
    // reachable by scrolling the content alone), while the banner frame
    // stays outside it — only `main` scrolls, never the navigation frame.
    const main = screen.getByRole("main");
    expect(within(main).getByText(/University of Gondar — Digital Platform/)).toBeTruthy();
    expect(within(main).queryByRole("banner")).toBeNull();
    expect(screen.getByRole("banner")).toBeTruthy();
  });

  it("opens and closes the mobile navigation drawer from the header toggle", async () => {
    render(
      <AdminShell identity="test-shell">
        <p>Page content</p>
      </AdminShell>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));

    // MUI v6 temporary Drawer: role="presentation" modal that aria-hides the
    // rest of the app — assert on the drawer paper content instead.
    const drawerPaper = document.querySelector(".MuiDrawer-paper");
    expect(drawerPaper).toBeTruthy();
    const drawer = within(drawerPaper as HTMLElement);
    expect(
      drawer.getByRole("navigation", { name: "Admin sections" }),
    ).toBeTruthy();
    expect(await drawer.findByRole("link", { name: /Organizations/ })).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1); // desktop and mobile share the provider
    expect(
      // The toggle lives in the app root, which the open Modal aria-hides.
      screen
        .getByRole("button", { name: "Open navigation menu", hidden: true })
        .getAttribute("aria-expanded"),
    ).toBe("true");

    fireEvent.click(drawer.getByRole("button", { name: "Close navigation menu" }));
    // The drawer unmounts after its exit transition.
    await waitFor(() =>
      expect(document.querySelector(".MuiDrawer-paper")).toBeNull(),
    );
  });

  it("keeps Site navigation but hides the workspace picker for Site administrators", async () => {
    pathname.mockReturnValue("/sites/102/admin");
    workspaceResponse = {
      schemaVersion: 1,
      version: "site-v1",
      platformPermissions: [],
      site: {
        id: 102,
        name: "AAU Builder Comparison",
        code: "AAU-COMPARISON",
        status: "ACTIVE",
        organization: { id: 12, name: "Addis Ababa University" },
        defaultLanguage: "en-us",
        enabledLanguages: ["en-us"],
        primaryDomain: null,
        homepageId: null,
        permissions: ["content.pages.view"],
        enabledModuleCodes: ["PAGES"],
      },
    };

    render(
      <AdminShell identity="site-admin-shell">
        <p>Site portal content</p>
      </AdminShell>,
    );

    const banner = screen.getByRole("banner");
    expect(await within(banner).findByText("UoG Administration Digital Platform")).toBeTruthy();
    expect(await within(banner).findByText("AAU Builder Comparison")).toBeTruthy();
    expect(screen.getByRole("complementary")).toBeTruthy();
    expect(await screen.findByRole("navigation", { name: "Site sections" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open navigation menu" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Workspace:/ })).toBeNull();
    expect(screen.getByText("Site portal content")).toBeTruthy();
  });
});
