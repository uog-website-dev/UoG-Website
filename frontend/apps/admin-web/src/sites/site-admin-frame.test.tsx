import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const pathname = vi.fn(() => "/sites/11/admin");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => pathname(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { SiteAdminDenied, SiteAdminFrame, SiteSection } from "./site-admin-frame";
import type { SiteAdminSite } from "./site-admin-frame";

const informatics: SiteAdminSite = {
  id: 11,
  name: "Informatics",
  code: "INFORMATICS",
  status: "ACTIVE",
  organizationId: 4,
  organizationName: "College of Informatics",
};
const medicine: SiteAdminSite = { id: 22, name: "Medicine", code: "MEDICINE", status: "SUSPENDED", organizationId: 9 };

function renderFrame(
  access: { enabledModuleCodes: string[]; permissions: string[] },
  site: SiteAdminSite = informatics,
  children: React.ReactNode = <p>Workspace</p>,
) {
  return render(
    <SiteAdminFrame site={site} enabledModuleCodes={access.enabledModuleCodes} permissions={access.permissions}>
      {children}
    </SiteAdminFrame>,
  );
}

beforeEach(() => {
  push.mockReset();
  pathname.mockReturnValue("/sites/11/admin");
});

describe("SiteAdminFrame", () => {
  it("leaves Site identity to the navigation rail instead of a dashboard banner", () => {
    renderFrame({ enabledModuleCodes: ["PAGES"], permissions: ["content.pages.view"] });
    expect(screen.queryByRole("region", { name: "Active Site" })).toBeNull();
    expect(screen.queryByText("Site administration")).toBeNull();
    expect(screen.queryByRole("link", { name: /View Public Website/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Central module registry" })).toBeNull();
    expect(screen.queryByText(/Central module activation stays in platform administration/)).toBeNull();
  });

  it("shows the current section in the breadcrumb", () => {
    pathname.mockReturnValue("/sites/11/admin/pages");
    renderFrame({ enabledModuleCodes: ["PAGES"], permissions: ["content.pages.view"] });
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByText("Pages")).toBeTruthy();
    expect(within(crumbs).getByRole("link", { name: "Informatics" }).getAttribute("href")).toBe("/sites/11/admin");
  });

  it("keeps the central registry out of the Site workspace even when delegated", () => {
    renderFrame({ enabledModuleCodes: [], permissions: ["platform.sites.manage_registry"] });
    expect(screen.queryByRole("link", { name: "Central module registry" })).toBeNull();
    expect(screen.queryByText(/Central module activation stays in platform administration/)).toBeNull();
  });

  it("remounts per Site so a draft does not follow the user", () => {
    const view = renderFrame(
      { enabledModuleCodes: ["PAGES"], permissions: ["content.pages.view"] },
      informatics,
      <input aria-label="Draft title" />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Draft title" }), { target: { value: "Secret draft" } });
    pathname.mockReturnValue("/sites/22/admin");
    view.rerender(
      <SiteAdminFrame site={medicine} enabledModuleCodes={["PAGES"]} permissions={["content.pages.view"]}>
        <input aria-label="Draft title" />
      </SiteAdminFrame>,
    );
    expect(screen.getByRole("textbox", { name: "Draft title" })).toHaveProperty("value", "");
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "Medicine" })).toBeTruthy();
  });

  it("blocks a direct section when the module or permission is missing", () => {
    renderFrame(
      { enabledModuleCodes: [], permissions: ["content.pages.view"] },
      informatics,
      <SiteSection sectionKey="pages"><button type="button">Create page</button></SiteSection>,
    );
    expect(screen.getByText(/Pages are not enabled for this Site/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create page" })).toBeNull();
  });

  it("blocks direct Posts administration when the Posts module is disabled", () => {
    renderFrame(
      { enabledModuleCodes: [], permissions: ["content.posts.view", "content.posts.create"] },
      informatics,
      <SiteSection sectionKey="posts"><button type="button">Create Post</button></SiteSection>,
    );
    expect(screen.getByText(/Posts are not enabled for this Site/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create Post" })).toBeNull();
  });

  it("blocks a section the account has no permission for", () => {
    renderFrame(
      { enabledModuleCodes: ["MENUS"], permissions: [] },
      informatics,
      <SiteSection sectionKey="menus"><button type="button">Create menu</button></SiteSection>,
    );
    expect(screen.getByText(/You do not have permission to open Menus/)).toBeTruthy();
  });
});

describe("SiteAdminDenied", () => {
  it("offers only the supplied authorized Sites", () => {
    render(<SiteAdminDenied sites={[{ id: 22, name: "Medicine" }]} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Site" }), { target: { value: "22" } });
    expect(push).toHaveBeenCalledWith("/sites/22/admin");
  });
});
