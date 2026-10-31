import { fireEvent, render, screen } from "@testing-library/react";
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

import { SiteAdminFrame, SiteSection } from "./site-admin-frame";
import type { SiteAdminSite } from "./site-admin-frame";

const informatics: SiteAdminSite = { id: 11, name: "Informatics", code: "INFORMATICS", status: "ACTIVE" };
const medicine: SiteAdminSite = { id: 22, name: "Medicine", code: "MEDICINE", status: "ACTIVE" };

function renderFrame(
  access: { enabledModuleCodes: string[]; permissions: string[] },
  site: SiteAdminSite = informatics,
  children: React.ReactNode = <p>Workspace</p>,
) {
  return render(
    <SiteAdminFrame
      site={site}
      sites={[informatics, medicine]}
      enabledModuleCodes={access.enabledModuleCodes}
      permissions={access.permissions}
    >
      {children}
    </SiteAdminFrame>,
  );
}

beforeEach(() => {
  push.mockReset();
  pathname.mockReturnValue("/sites/11/admin");
});

describe("SiteAdminFrame", () => {
  it("lists only the supplied Sites and the sections this account may open", () => {
    renderFrame({
      enabledModuleCodes: ["PAGES"],
      permissions: ["content.pages.view"],
    });
    const selector = screen.getByRole("combobox", { name: "Site" });
    const labels = Array.from(selector.querySelectorAll("option")).map((option) => option.textContent);
    expect(labels).toEqual(["Informatics", "Medicine"]);
    expect(screen.getByRole("link", { name: "Pages" }).getAttribute("href")).toBe("/sites/11/admin/pages");
    expect(screen.queryByRole("link", { name: "Posts" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Menus" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Central module registry" })).toBeNull();
    expect(screen.getByText(/Central module activation stays in platform administration/)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Informatics" })).toBeTruthy();
  });

  it("shows the central registry only when that permission was delegated", () => {
    renderFrame({
      enabledModuleCodes: [],
      permissions: ["platform.sites.manage_registry"],
    });
    expect(screen.getByRole("link", { name: "Central module registry" }).getAttribute("href")).toBe("/modules");
  });

  it("switches to the other Site's dashboard and drops the previous draft", () => {
    const view = renderFrame(
      { enabledModuleCodes: ["PAGES"], permissions: ["content.pages.view"] },
      informatics,
      <input aria-label="Draft title" />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Draft title" }), {
      target: { value: "Secret draft" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Site" }), {
      target: { value: "22" },
    });
    expect(push).toHaveBeenCalledWith("/sites/22/admin");
    view.rerender(
      <SiteAdminFrame
        site={medicine}
        sites={[informatics, medicine]}
        enabledModuleCodes={["PAGES"]}
        permissions={["content.pages.view"]}
      >
        <input aria-label="Draft title" />
      </SiteAdminFrame>,
    );
    expect(screen.getByRole("textbox", { name: "Draft title" })).toHaveProperty("value", "");
    expect(screen.getByRole("heading", { level: 1, name: "Medicine" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Pages" }).getAttribute("href")).toBe("/sites/22/admin/pages");
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

  it("opens the site menu from the keyboard and closes it with Escape", () => {
    renderFrame({
      enabledModuleCodes: ["MENUS"],
      permissions: ["menu.read"],
    });
    const open = screen.getByRole("button", { name: "Open site menu" });
    open.focus();
    expect(document.activeElement).toBe(open);
    fireEvent.keyDown(open, { key: "Enter" });
    fireEvent.click(open);
    expect(open.getAttribute("aria-expanded")).toBe("true");
    const menu = document.getElementById("site-admin-menu");
    expect(menu).toBeTruthy();
    fireEvent.keyDown(menu as HTMLElement, { key: "Escape", code: "Escape" });
    expect(open.getAttribute("aria-expanded")).toBe("false");
  });
});
