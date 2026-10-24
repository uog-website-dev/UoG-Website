import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const pathname = vi.fn(() => "/");

vi.mock("next/navigation", () => ({
  usePathname: () => pathname(),
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

import { DesktopSidebar } from "@/sidebar";

describe("DesktopSidebar", () => {
  it("renders Dashboard, Organizations and Sites as base-path-relative links", () => {
    render(<DesktopSidebar />);

    const nav = screen.getByRole("navigation", { name: "Admin sections" });
    expect(nav).toBeTruthy();
    expect(screen.getByText("UoG Administration")).toBeTruthy();
    expect(screen.getByText("Workspace")).toBeTruthy();
    expect(screen.getByText("Admin workspace")).toBeTruthy();
    expect(screen.queryByText(/Shell preview/)).toBeNull();

    const links = screen.getAllByRole("link");
    const byText = (label: string) =>
      links.find((link) => link.textContent?.includes(label));

    expect(byText("Dashboard")?.getAttribute("href")).toBe("/");
    expect(byText("Organizations")?.getAttribute("href")).toBe("/organizations");
    expect(byText("Sites")?.getAttribute("href")).toBe("/sites");
  });

  it("marks the current section with aria-current", () => {
    pathname.mockReturnValue("/organizations");
    render(<DesktopSidebar />);

    const organizations = screen
      .getAllByRole("link")
      .find((link) => link.textContent?.includes("Organizations"));

    expect(organizations?.getAttribute("aria-current")).toBe("page");

    const sites = screen
      .getAllByRole("link")
      .find((link) => link.textContent?.includes("Sites"));
    expect(sites?.getAttribute("aria-current")).toBeNull();
  });

  it("matches the active section even when the pathname includes the base path", () => {
    pathname.mockReturnValue("/admin/sites");
    render(<DesktopSidebar />);

    const sites = screen
      .getAllByRole("link")
      .find((link) => link.textContent?.includes("Sites"));
    expect(sites?.getAttribute("aria-current")).toBe("page");
  });
});
