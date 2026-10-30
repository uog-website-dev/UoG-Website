import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { menusFromResponse, PublicMenuFrame, safeMenuHref } from "./site-navigation";

const header = [
  { label: "Department", href: "/about", children: [{ label: "People", href: "/about/people" }] },
  { label: "Blocked", href: "javascript:alert(1)" },
];
const footer = [{ label: "Contacts", href: "/contacts" }];

describe("safeMenuHref", () => {
  it("keeps same-site paths and http(s) URLs", () => {
    expect(safeMenuHref("/about")).toBe("/about");
    expect(safeMenuHref("https://example.com/news")).toBe("https://example.com/news");
  });

  it("rejects scriptable, protocol-relative and credentialed targets", () => {
    for (const value of ["javascript:alert(1)", "data:text/html,bad", "//evil.example", "https://user:pass@example.com/"]) {
      expect(safeMenuHref(value)).toBeNull();
    }
  });
});

describe("menusFromResponse", () => {
  it("reads only the resolved Site header and footer", () => {
    const parsed = menusFromResponse(200, {
      site: 11,
      locations: {
        header: [{ label: "Department", href: "/about", children: [] }],
        footer: [{ label: "Contacts", href: "/contacts", children: [] }],
        sidebar: [{ label: "Not shown", href: "/side" }],
      },
      otherSite: [{ label: "Hospital", href: "/hospital" }],
    });
    expect(parsed.header.map((item) => item.label)).toEqual(["Department"]);
    expect(parsed.footer.map((item) => item.label)).toEqual(["Contacts"]);
    expect(JSON.stringify(parsed)).not.toContain("Hospital");
  });

  it("treats a disabled module as an empty menu", () => {
    expect(menusFromResponse(404, { error: { code: "not_found" } })).toEqual({
      header: [],
      footer: [],
    });
  });
});

describe("PublicMenuFrame", () => {
  it("shows this Site's header and footer and does not link unsafe URLs", () => {
    render(
      <PublicMenuFrame header={header} footer={footer}>
        <p>Page</p>
      </PublicMenuFrame>,
    );
    expect(screen.getAllByRole("link", { name: "Department" }).every((link) => link.getAttribute("href") === "/about")).toBe(true);
    expect(screen.getByRole("link", { name: "Contacts" }).getAttribute("href")).toBe("/contacts");
    expect(screen.queryByRole("link", { name: "Blocked" })).toBeNull();
    expect(screen.getByText("Blocked").tagName).toBe("SPAN");
    expect(screen.queryByText("Hospital")).toBeNull();
  });

  it("opens the mobile header from the keyboard and closes it with Escape", async () => {
    const user = userEvent.setup();
    render(
      <PublicMenuFrame header={header} footer={footer}>
        <p>Page</p>
      </PublicMenuFrame>,
    );
    const open = screen.getByRole("button", { name: "Open site header" });
    open.focus();
    expect(document.activeElement).toBe(open);
    await user.keyboard("{Enter}");
    const drawerPaper = document.querySelector(".MuiDrawer-paper");
    expect(drawerPaper).toBeTruthy();
    const drawer = within(drawerPaper as HTMLElement);
    expect(drawer.getByRole("link", { name: "People" })).toBeTruthy();
    expect(open.getAttribute("aria-expanded")).toBe("true");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.querySelector(".MuiDrawer-paper")).toBeNull());
  });

  it("closes the mobile header from its close button", async () => {
    render(
      <PublicMenuFrame header={[{ label: "Department", href: "/about" }]} footer={[]}>
        <p>Page</p>
      </PublicMenuFrame>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open site header" }));
    const drawerPaper = document.querySelector(".MuiDrawer-paper") as HTMLElement;
    fireEvent.click(within(drawerPaper).getByRole("button", { name: "Close site header" }));
    await waitFor(() => expect(document.querySelector(".MuiDrawer-paper")).toBeNull());
  });
});
