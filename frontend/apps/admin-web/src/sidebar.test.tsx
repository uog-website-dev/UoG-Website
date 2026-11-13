import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspacePayload } from "@/workspace";

const pathname = vi.fn(() => "/");
const push = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => pathname(),
  useRouter: () => ({ push }),
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

const signInAgainIfExpired = vi.fn(async () => true);
vi.mock("@/session-watch", () => ({ signInAgainIfExpired: () => signInAgainIfExpired() }));

import { DesktopSidebar } from "@/sidebar";

const SITES = [
  { id: 2, name: "Informatics", code: "INFORMATICS", status: "ACTIVE" as const },
  { id: 3, name: "Medicine", code: "MEDICINE", status: "ACTIVE" as const },
];

const PLATFORM_ADMIN: string[] = [
  "platform.dashboard.view",
  "platform.organizations.view",
  "sites.view",
  "platform.sites.manage_registry",
  "platform.roles.view",
];

let payload: WorkspacePayload;
let fetchMock: ReturnType<typeof vi.fn>;

function respond(next: Partial<WorkspacePayload>) {
  payload = { platformPermissions: [], sites: SITES, sitesError: null, site: null, ...next };
}

beforeEach(() => {
  pathname.mockReturnValue("/");
  push.mockReset();
  respond({ platformPermissions: PLATFORM_ADMIN });
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => payload }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function linkNamed(label: string) {
  return screen.queryAllByRole("link").find((link) => link.textContent?.includes(label));
}

describe("DesktopSidebar — platform workspace", () => {
  it("renders platform sections as base-path-relative links for a platform administrator", async () => {
    render(<DesktopSidebar />);

    const nav = await screen.findByRole("navigation", { name: "Admin sections" });
    await within(nav).findByText("Organizations");
    expect(screen.getByText("UoG Administration")).toBeTruthy();
    expect(screen.getByText("Admin workspace")).toBeTruthy();
    expect(linkNamed("Dashboard")?.getAttribute("href")).toBe("/");
    expect(linkNamed("Organizations")?.getAttribute("href")).toBe("/organizations");
    expect(linkNamed("Sites")?.getAttribute("href")).toBe("/sites");
    expect(linkNamed("Modules")?.getAttribute("href")).toBe("/modules");
    expect(fetchMock).toHaveBeenCalledWith("/admin/api/workspace/", { cache: "no-store" });
  });

  it("marks the current section with aria-current, with or without the base path", async () => {
    pathname.mockReturnValue("/admin/organizations");
    render(<DesktopSidebar />);
    await screen.findByText("Organizations");
    expect(linkNamed("Organizations")?.getAttribute("aria-current")).toBe("page");
    expect(linkNamed("Sites")?.getAttribute("aria-current")).toBeNull();
  });

  it("hides platform navigation from a Site-only account and offers its Sites", async () => {
    respond({ platformPermissions: [] });
    render(<DesktopSidebar />);

    expect(await screen.findByText(/Platform administration is not assigned/)).toBeTruthy();
    for (const label of ["Dashboard", "Organizations", "Sites", "Domains", "Modules", "Access control"]) {
      expect(linkNamed(label)).toBeUndefined();
    }
    const selector = screen.getByRole("combobox", { name: "Workspace" });
    const options = Array.from(selector.querySelectorAll("option:not([disabled])")).map((row) => row.textContent);
    expect(options).toEqual(["Informatics", "Medicine"]);
  });

  it("switches to a Site workspace from the keyboard-operable selector", async () => {
    render(<DesktopSidebar />);
    const selector = await screen.findByRole("combobox", { name: "Workspace" });
    await waitFor(() => expect(selector).toHaveProperty("disabled", false));
    expect(selector).toHaveProperty("value", "platform");
    fireEvent.change(selector, { target: { value: "site:3" } });
    expect(push).toHaveBeenCalledWith("/sites/3/admin");
  });

  it("reports a failed workspace read instead of an empty menu", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    render(<DesktopSidebar />);
    expect(await screen.findByText(/Navigation could not be loaded/)).toBeTruthy();
  });

  it("reports Site list failures without claiming that no workspace is assigned", async () => {
    respond({ platformPermissions: [], sites: [], sitesError: "Service unavailable" });
    render(<DesktopSidebar />);
    expect(await screen.findByText(/Site workspaces could not be loaded: Service unavailable/)).toBeTruthy();
    expect(screen.queryByText(/No administration workspace is assigned/)).toBeNull();
    expect(screen.getByRole("combobox", { name: "Workspace" })).toHaveProperty("disabled", true);
  });

  it("tells a signed-out user to sign in again instead of hiding navigation silently", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
    render(<DesktopSidebar />);
    expect(await screen.findByText(/Your session has expired/)).toBeTruthy();
    expect(screen.queryByText(/Platform administration is not assigned/)).toBeNull();
    expect(signInAgainIfExpired).toHaveBeenCalledTimes(1);
  });

  it("does not start a new sign-in for other failures", async () => {
    signInAgainIfExpired.mockClear();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    render(<DesktopSidebar />);
    expect(await screen.findByText(/Navigation could not be loaded/)).toBeTruthy();
    expect(signInAgainIfExpired).not.toHaveBeenCalled();
  });
});

describe("DesktopSidebar — Site workspace", () => {
  it("shows the Visual Builder menu and keeps it active while editing a Page canvas",async()=>{
    pathname.mockReturnValue("/sites/2/admin/pages/page-id/builder");
    respond({platformPermissions:[],site:{id:2,enabledModuleCodes:["PAGES"],permissions:["content.pages.view","content.pages.update"]}});
    render(<DesktopSidebar/>);
    const nav=await screen.findByRole("navigation",{name:"Site sections"});
    const builder=await within(nav).findByRole("link",{name:/Visual Builder/});
    expect(builder.getAttribute("href")).toBe("/sites/2/admin/builder");
    expect(builder.getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link",{name:/Pages Site pages/}).getAttribute("aria-current")).toBeNull();
  });
  it("shows the active Site and only its enabled, authorized sections", async () => {
    pathname.mockReturnValue("/sites/2/admin/pages");
    respond({
      platformPermissions: [],
      site: { id: 2, enabledModuleCodes: ["PAGES", "MENUS"], permissions: ["content.pages.view"] },
    });
    render(<DesktopSidebar />);

    const nav = await screen.findByRole("navigation", { name: "Site sections" });
    expect(await within(nav).findByText("Informatics")).toBeTruthy();
    expect(within(nav).getByText("Active")).toBeTruthy();
    const pages = within(nav).getAllByRole("link").find((link) => link.textContent?.includes("Pages"));
    expect(pages?.getAttribute("href")).toBe("/sites/2/admin/pages");
    expect(pages?.getAttribute("aria-current")).toBe("page");
    expect(within(nav).getAllByRole("link").find((link) => link.textContent?.includes("Dashboard"))?.getAttribute("href"))
      .toBe("/sites/2/admin");
    // MENUS is enabled but menu.read was not granted; POSTS is not enabled.
    expect(within(nav).queryAllByRole("link").some((link) => link.textContent?.includes("Menus"))).toBe(false);
    expect(within(nav).queryAllByRole("link").some((link) => link.textContent?.includes("Posts"))).toBe(false);
    expect(screen.getByRole("combobox", { name: "Workspace" })).toHaveProperty("value", "site:2");
    expect(fetchMock).toHaveBeenCalledWith("/admin/api/workspace/?site=2", { cache: "no-store" });
  });

  it("does not render sections for a Site outside the authorized list", async () => {
    pathname.mockReturnValue("/sites/99/admin");
    respond({ platformPermissions: [], site: null });
    render(<DesktopSidebar />);
    expect(await screen.findByText("This Site is not available to your account.")).toBeTruthy();
    expect(linkNamed("Pages")).toBeUndefined();
  });
});
