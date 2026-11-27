import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_SITE } from "./public-site";
import { PublicSiteFooter } from "./site-footer";

const site = { ...EMPTY_SITE, id: 11, name: "Informatics", displayName: "Informatics" };
const links = Array.from({ length: 8 }, (_, index) => ({ label: `Link ${index + 1}`, href: `/link-${index + 1}` }));
const columns = [
  { label: "Explore", href: "", column: true, description: "Public footer copy", children: links },
  { label: "About us", href: "", column: true, children: [{ label: "Contact", href: "/contact" }] },
];

afterEach(cleanup);

describe("PublicSiteFooter mobile columns", () => {
  it("collapses columns by default and exposes keyboard state changes", () => {
    render(<PublicSiteFooter site={site} items={columns} />);
    const toggle = screen.getByRole("button", { name: "Expand Explore" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!);
    expect(panel).toBeTruthy();
    expect(panel!.contains(screen.getByRole("link", { name: "Link 1" }))).toBe(true);

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Collapse Explore" })).toBeTruthy();
    fireEvent.keyDown(toggle, { key: "Escape" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("caps long groups behind a More disclosure", () => {
    render(<PublicSiteFooter site={site} items={columns} />);
    const more = screen.getByRole("button", { name: "More Explore links" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Show fewer Explore links" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Link 7" }).getAttribute("href")).toBe("/link-7");
  });

  it("keeps the public heading, description and links scannable", () => {
    render(<PublicSiteFooter site={site} items={columns} />);
    expect(screen.getByText("Public footer copy")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Footer navigation" })).toBeTruthy();
    expect(document.querySelectorAll("[data-footer-group]")).toHaveLength(2);
  });
});
