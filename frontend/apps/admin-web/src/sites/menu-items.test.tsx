import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@uog/ui";

import type { MenuLocationState, MenuTargets } from "@/app/sites/menu-actions";

const createMenuLink = vi.fn();
const updateMenuItem = vi.fn();
const deleteMenuItem = vi.fn();
const moveMenuItem = vi.fn();
const reorderSiteMenu = vi.fn();

vi.mock("@/app/sites/menu-actions", () => ({
  createMenuLink: (...args: unknown[]) => createMenuLink(...args),
  updateMenuItem: (...args: unknown[]) => updateMenuItem(...args),
  deleteMenuItem: (...args: unknown[]) => deleteMenuItem(...args),
  moveMenuItem: (...args: unknown[]) => moveMenuItem(...args),
  reorderSiteMenu: (...args: unknown[]) => reorderSiteMenu(...args),
}));

import { MenuItemTree } from "./menu-items";

const TARGETS: MenuTargets = {
  pages: [{ id: "page-1", label: "About page" }],
  posts: [{ id: "post-1", label: "Campus news" }],
  pagesAvailable: true,
  postsAvailable: true,
};

function state(): MenuLocationState {
  return {
    menu: {
      id: "menu-1",
      site: 11,
      location: "header",
      name: "Header",
      is_active: false,
      is_global: false,
    },
    etag: '"menu-1-v3"',
    items: [
      { id: "a", label: "About", parent: null, sort_order: 0, target: "/about", item_type: "custom", is_active: true },
      { id: "b", label: "News", parent: null, sort_order: 1, target: "/news", item_type: "custom", is_active: true },
    ],
  };
}

function renderTree(
  current = state(),
  targets: MenuTargets = TARGETS,
  onChanged = vi.fn(),
) {
  return render(
    <ToastProvider>
      <MenuItemTree siteId={11} state={current} targets={targets} enabled onChanged={onChanged} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  reorderSiteMenu.mockResolvedValue({ ok: true, data: { etag: '"menu-1-v4"' } });
  moveMenuItem.mockResolvedValue({ ok: true, data: { etag: '"menu-1-v4"' } });
  createMenuLink.mockResolvedValue({ ok: true, data: state().items[0] });
  updateMenuItem.mockResolvedValue({ ok: true, data: state().items[0] });
  deleteMenuItem.mockResolvedValue({ ok: true, data: { etag: '"menu-1-v4"' } });
});

describe("MenuItemTree", () => {
  it("moves, nests and lifts items from the keyboard for this Site only", async () => {
    const onChanged = vi.fn();
    renderTree(state(), TARGETS, onChanged);
    const nest = await screen.findByRole("button", { name: "Nest News" });
    nest.focus();
    expect(document.activeElement).toBe(nest);
    fireEvent.click(nest);
    await waitFor(() => expect(moveMenuItem).toHaveBeenCalledWith(11, "menu-1", "b", '"menu-1-v3"', "a", 0));
    expect(JSON.stringify(moveMenuItem.mock.calls)).not.toContain("22");

    const nested = state();
    nested.items = [
      ...state().items,
      { id: "c", label: "Campus", parent: "a", sort_order: 0, target: "/campus", item_type: "custom", is_active: true },
    ];
    renderTree(nested, TARGETS, onChanged);
    fireEvent.click(screen.getByRole("button", { name: "Move Campus out" }));
    await waitFor(() => expect(moveMenuItem).toHaveBeenCalledWith(11, "menu-1", "c", '"menu-1-v3"', null, 1));
    expect(onChanged).toHaveBeenCalled();
  });

  it("reorders by dropping an item onto a sibling", async () => {
    renderTree();
    const about = await screen.findByRole("listitem", { name: "About" });
    const news = screen.getByRole("listitem", { name: "News" });
    fireEvent.dragStart(about);
    fireEvent.dragOver(news);
    fireEvent.drop(news);
    await waitFor(() => expect(reorderSiteMenu).toHaveBeenCalledWith(11, "menu-1", '"menu-1-v3"', null, ["b", "a"]));
  });

  it("blocks an unsafe external URL and an unavailable Page", async () => {
    renderTree();
    const form = await screen.findByRole("form", { name: "Add to Header" });
    fireEvent.change(within(form).getByLabelText(/Item label/), { target: { value: "Library" } });
    fireEvent.change(within(form).getByLabelText(/Item target/), { target: { value: "external" } });
    fireEvent.change(within(form).getByLabelText(/External URL/), { target: { value: "javascript:alert(1)" } });
    expect(within(form).getByText(/External URLs must use http or https/)).toBeTruthy();
    expect(within(form).getByRole("button", { name: "Add link" })).toHaveProperty("disabled", true);
    fireEvent.click(within(form).getByRole("button", { name: "Add link" }));
    expect(createMenuLink).not.toHaveBeenCalled();

    fireEvent.change(within(form).getByLabelText(/Item target/), { target: { value: "page" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add link" }));
    expect(createMenuLink).not.toHaveBeenCalled();
    expect(within(form).getByText(/Choose a Page from this Site/)).toBeTruthy();
  });

  it("saves a Page target and removes a leaf", async () => {
    renderTree();
    const form = await screen.findByRole("form", { name: "Add to Header" });
    fireEvent.change(within(form).getByLabelText(/Item label/), { target: { value: "About page" } });
    fireEvent.change(within(form).getByLabelText(/Item target/), { target: { value: "page" } });
    fireEvent.change(within(form).getByLabelText(/^Page/), { target: { value: "page-1" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add link" }));
    await waitFor(() => expect(createMenuLink).toHaveBeenCalledWith(11, "menu-1", '"menu-1-v3"', {
      label: "About page",
      item_type: "page",
      target: "",
      page: "page-1",
      post: null,
      parent: null,
    }));

    fireEvent.click(screen.getByRole("button", { name: "Edit About" }));
    const edit = screen.getByRole("form", { name: "Edit About" });
    fireEvent.change(within(edit).getByLabelText(/Item label/), { target: { value: "About us" } });
    fireEvent.click(within(edit).getByRole("button", { name: "Save item" }));
    await waitFor(() => expect(updateMenuItem).toHaveBeenCalledWith(
      11, "menu-1", "a", '"menu-1-v3"',
      expect.objectContaining({ label: "About us", item_type: "custom" }),
    ));

    fireEvent.click(screen.getByRole("button", { name: "Remove News" }));
    await waitFor(() => expect(deleteMenuItem).toHaveBeenCalledWith(11, "menu-1", "b", '"menu-1-v3"'));
  });

  it("reports a version conflict and does not send the stale change again", async () => {
    const onChanged = vi.fn();
    reorderSiteMenu.mockResolvedValue({
      ok: false,
      error: {
        status: 409,
        code: "conflict",
        message: "The request conflicts with the current resource state.",
        details: { reason: "version_conflict" },
        requestId: "req-1",
      },
    });
    renderTree(state(), TARGETS, onChanged);
    fireEvent.click(await screen.findByRole("button", { name: "Move About down" }));
    expect(await screen.findByText(/saved by someone else/)).toBeTruthy();
    expect(reorderSiteMenu).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("warns when Pages cannot be loaded and keeps an unavailable target visible", async () => {
    const current = state();
    current.items[0] = {
      ...current.items[0]!,
      item_type: "page",
      page: "missing-page",
      target: "",
    };
    renderTree(current, { ...TARGETS, pages: [], pagesAvailable: false });
    expect(await screen.findByText(/Pages are not available for this Site/)).toBeTruthy();
    expect(screen.getByText("Unavailable Page")).toBeTruthy();
    const form = screen.getByRole("form", { name: "Add to Header" });
    expect(within(form).getByRole("option", { name: "Page" })).toHaveProperty("disabled", true);
  });
});
