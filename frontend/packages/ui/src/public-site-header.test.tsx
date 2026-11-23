import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EMPTY_SITE } from "./public-site";
import { PublicSiteHeader } from "./public-site-header";

const base = { ...EMPTY_SITE, id: 11, name: "Informatics", displayName: "Informatics" };
const menu = [{ label: "About", href: "/about" }, { label: "Study", href: "/study" }];

describe("PublicSiteHeader", () => {
  it("renders the published menus and the default brand link", () => {
    render(<PublicSiteHeader site={{ ...base, modules: { pages: true, posts: false, menus: true } }} headerItems={menu} />);
    const header = document.querySelector('[data-site-header="11"]') as HTMLElement;
    expect(header).toBeTruthy();
    expect(header.querySelector('a[href="/"]')).toBeTruthy();
    expect(screen.getByRole("link", { name: "About" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Study" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Search this Site" })).toBeTruthy();
  });

  it("hides search when neither PAGES nor POSTS is enabled", () => {
    render(<PublicSiteHeader site={{ ...base, modules: { pages: false, posts: false, menus: true } }} />);
    expect(screen.queryByRole("button", { name: "Search this Site" })).toBeNull();
  });

  it("hides search when the Site turns it off even with PAGES enabled", () => {
    render(<PublicSiteHeader site={{ ...base, modules: { pages: true, posts: false, menus: true } }} settings={{
      brand_href: "/", search_enabled: false, sticky: false, cta_label: "", cta_url: "", language_switcher: false,
    }} />);
    expect(screen.queryByRole("button", { name: "Search this Site" })).toBeNull();
  });

  it("renders a safe call to action and rejects scriptable destinations", () => {
    const view = render(<PublicSiteHeader site={base} settings={{
      brand_href: "/", search_enabled: true, sticky: false,
      cta_label: "Apply now", cta_url: "/apply", language_switcher: false,
    }} />);
    expect(screen.getByRole("link", { name: "Apply now" }).getAttribute("href")).toBe("/apply");
    view.rerender(<PublicSiteHeader site={base} settings={{
      brand_href: "/", search_enabled: true, sticky: false,
      cta_label: "Apply now", cta_url: "javascript:alert(1)", language_switcher: false,
    }} />);
    expect(screen.queryByRole("link", { name: "Apply now" })).toBeNull();
  });

  it("applies sticky behaviour only when configured", () => {
    const view = render(<PublicSiteHeader site={base} />);
    const header = () => document.querySelector('[data-site-header="11"]') as HTMLElement;
    expect(header().getAttribute("data-site-header-sticky")).toBeNull();
    view.rerender(<PublicSiteHeader site={base} settings={{
      brand_href: "/", search_enabled: true, sticky: true, cta_label: "", cta_url: "", language_switcher: false,
    }} />);
    expect(header().getAttribute("data-site-header-sticky")).toBe("true");
    expect(getComputedStyle(header()).position).toBe("sticky");
  });
});
