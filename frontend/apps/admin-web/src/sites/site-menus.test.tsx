import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@uog/ui";

import type { MenuLocationState } from "@/app/sites/menu-actions";

const loadSiteNavigation = vi.fn();
const createSiteMenu = vi.fn();
const createMenuLink = vi.fn();
const reorderSiteMenu = vi.fn();
const setMenuActive = vi.fn();

vi.mock("@/app/sites/menu-actions", () => ({
  loadSiteNavigation: (...args: unknown[]) => loadSiteNavigation(...args),
  createSiteMenu: (...args: unknown[]) => createSiteMenu(...args),
  createMenuLink: (...args: unknown[]) => createMenuLink(...args),
  reorderSiteMenu: (...args: unknown[]) => reorderSiteMenu(...args),
  setMenuActive: (...args: unknown[]) => setMenuActive(...args),
}));

import { SiteMenusPanel } from "./site-menus";

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

function renderPanel(siteId = 11, menusEnabled: boolean | null = true) {
  return render(
    <ToastProvider>
      <SiteMenusPanel siteId={siteId} menusEnabled={menusEnabled} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  loadSiteNavigation.mockResolvedValue({
    ok: true,
    data: { header: headerState(), footer: null },
  });
  reorderSiteMenu.mockResolvedValue({ ok: true, data: { etag: '"menu-1-v4"' } });
  createSiteMenu.mockResolvedValue({ ok: true, data: headerState().menu });
});

describe("SiteMenusPanel", () => {
  it("reorders the header with the keyboard-reachable move control and only for this Site", async () => {
    renderPanel(11);
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

  it("creates the footer for this Site without touching another Site", async () => {
    renderPanel(11);
    fireEvent.click(await screen.findByRole("button", { name: "Create footer menu" }));
    await waitFor(() => expect(createSiteMenu).toHaveBeenCalledWith(11, "footer"));
    expect(JSON.stringify(createSiteMenu.mock.calls)).not.toContain("22");
  });

  it("blocks changes when the MENUS module is off", async () => {
    renderPanel(11, false);
    const moveDown = await screen.findByRole("button", { name: "Move About down" });
    expect(moveDown).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Create footer menu" })).toHaveProperty("disabled", true);
    expect(screen.getByText(/public website does not serve navigation/)).toBeTruthy();
    fireEvent.click(moveDown);
    expect(reorderSiteMenu).not.toHaveBeenCalled();
  });
});
