import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@uog/ui";

import type { MenuLocationState, SiteNavigation } from "@/app/sites/menu-actions";

const loadSiteNavigation = vi.fn();
const createSiteMenu = vi.fn();
const createMenuLink = vi.fn();
const reorderSiteMenu = vi.fn();
const setMenuActive = vi.fn();
const updateSiteMenu = vi.fn();

vi.mock("@/app/sites/menu-actions", () => ({
  loadSiteNavigation: (...args: unknown[]) => loadSiteNavigation(...args),
  createSiteMenu: (...args: unknown[]) => createSiteMenu(...args),
  createMenuLink: (...args: unknown[]) => createMenuLink(...args),
  reorderSiteMenu: (...args: unknown[]) => reorderSiteMenu(...args),
  setMenuActive: (...args: unknown[]) => setMenuActive(...args),
  updateSiteMenu: (...args: unknown[]) => updateSiteMenu(...args),
}));

import { SiteMenusPanel } from "./site-menus";

const FULL = ["menu.read", "menu.write", "menu.publish"];

function headerState(): MenuLocationState {
  return {
    menu: {
      id: "menu-1",
      site: 11,
      location: "header",
      name: "Header",
      is_active: true,
      is_global: false,
    },
    etag: '"menu-1-v3"',
    items: [
      { id: "a", label: "About", parent: null, sort_order: 0, target: "/about", item_type: "custom", is_active: true },
      { id: "b", label: "News", parent: null, sort_order: 1, target: "/news", item_type: "custom", is_active: true },
    ],
  };
}

function navigation(overrides: Partial<SiteNavigation> = {}): SiteNavigation {
  return {
    menus: [headerState()],
    inheritance: [],
    ...overrides,
  };
}

function renderPanel(
  siteId = 11,
  menusEnabled: boolean | null = true,
  permissions: readonly string[] = FULL,
) {
  return render(
    <ToastProvider>
      <SiteMenusPanel siteId={siteId} menusEnabled={menusEnabled} permissions={permissions} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  loadSiteNavigation.mockResolvedValue({ ok: true, data: navigation() });
  reorderSiteMenu.mockResolvedValue({ ok: true, data: { etag: '"menu-1-v4"' } });
  createSiteMenu.mockResolvedValue({ ok: true, data: headerState().menu });
  updateSiteMenu.mockResolvedValue({ ok: true, data: headerState().menu });
});

describe("SiteMenusPanel", () => {
  it("reorders the header with the keyboard-reachable move control and only for this Site", async () => {
    renderPanel(11);
    expect(await screen.findByText(/Menus for Site 11/)).toBeTruthy();
    const moveDown = await screen.findByRole("button", { name: "Move About down" });
    expect(moveDown.tagName).toBe("BUTTON");
    moveDown.focus();
    expect(document.activeElement).toBe(moveDown);
    fireEvent.click(moveDown);
    await waitFor(() => expect(reorderSiteMenu).toHaveBeenCalledTimes(1));
    expect(reorderSiteMenu).toHaveBeenCalledWith(11, "menu-1", '"menu-1-v3"', null, ["b", "a"]);
    expect(loadSiteNavigation).toHaveBeenCalledWith(11);
    expect(JSON.stringify(reorderSiteMenu.mock.calls)).not.toContain("22");
    expect(screen.queryByText("Hospital")).toBeNull();
  });

  it("creates a local footer for this Site and edits its name and location", async () => {
    renderPanel(11);
    fireEvent.change(await screen.findByLabelText(/New menu name/), { target: { value: "Footer" } });
    fireEvent.change(screen.getByLabelText(/New menu location/), { target: { value: "footer" } });
    fireEvent.click(screen.getByRole("button", { name: "Create menu" }));
    await waitFor(() => expect(createSiteMenu).toHaveBeenCalledWith(11, "footer", "Footer"));
    expect(JSON.stringify(createSiteMenu.mock.calls)).not.toContain("22");

    fireEvent.click(screen.getByRole("button", { name: "Edit Header" }));
    fireEvent.change(screen.getByLabelText(/Local menu name/), { target: { value: "Campus header" } });
    fireEvent.change(screen.getByLabelText(/Assigned location/), { target: { value: "footer" } });
    fireEvent.click(screen.getByRole("button", { name: "Save menu" }));
    await waitFor(() => expect(updateSiteMenu).toHaveBeenCalledWith(
      11, "menu-1", '"menu-1-v3"', { name: "Campus header", location: "footer" },
    ));
    expect(JSON.stringify(updateSiteMenu.mock.calls)).not.toContain("22");
  });

  it("explains central and inherited ownership and does not edit a central menu", async () => {
    loadSiteNavigation.mockResolvedValue({
      ok: true,
      data: navigation({
        menus: [
          headerState(),
          {
            menu: {
              id: "global-1",
              site: 1,
              location: "header",
              name: "University",
              is_active: true,
              is_global: true,
            },
            etag: '"global-1-v1"',
            items: [
              { id: "g", label: "University", parent: null, sort_order: 0, target: "/about", item_type: "custom", is_active: true },
            ],
          },
        ],
        inheritance: [{
          id: "policy-1",
          site: 11,
          location: "header",
          inherit_from: 4,
          include_global: true,
          local_precedence: "append",
        }],
      }),
    });
    renderPanel(11);
    expect(await screen.findByText(/The platform owns this menu/)).toBeTruthy();
    expect(screen.getByText("Central")).toBeTruthy();
    expect(screen.getByText(/copies Site 4's own local menu/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit University" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move University down" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Unpublish University" })).toBeNull();
    expect(screen.getByRole("button", { name: "Edit Header" })).toBeTruthy();
  });

  it("shows an empty list and hides writes without menu permission", async () => {
    loadSiteNavigation.mockResolvedValue({ ok: true, data: navigation({ menus: [] }) });
    renderPanel(11, true, ["menu.read"]);
    expect(await screen.findByText("This Site has no menus yet.")).toBeTruthy();
    expect(screen.getByText(/Creating or editing a local menu needs menu write permission/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create menu" })).toBeNull();
    expect(createSiteMenu).not.toHaveBeenCalled();
  });

  it("shows the load error and keeps the selected Site on the request", async () => {
    loadSiteNavigation.mockResolvedValue({
      ok: false,
      error: { status: 500, code: "server_error", message: "Menus could not be loaded.", details: null, requestId: null },
    });
    renderPanel(22);
    expect((await screen.findByRole("alert")).textContent).toContain("Menus could not be loaded.");
    expect(loadSiteNavigation).toHaveBeenCalledWith(22);
    expect(JSON.stringify(loadSiteNavigation.mock.calls)).not.toContain("[11]");
  });

  it("blocks changes when the MENUS module is off", async () => {
    renderPanel(11, false);
    const moveDown = await screen.findByRole("button", { name: "Move About down" });
    expect(moveDown).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Create menu" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Edit Header" })).toHaveProperty("disabled", true);
    expect(screen.getByText(/public website does not serve navigation/)).toBeTruthy();
    fireEvent.click(moveDown);
    expect(reorderSiteMenu).not.toHaveBeenCalled();
  });
});
