import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

import { Breadcrumb } from "@/breadcrumb";

describe("Breadcrumb", () => {
  it("labels the trail for assistive technology", () => {
    render(
      <Breadcrumb
        items={[
          { label: "Home", href: "/" },
          { label: "Dashboard" },
        ]}
      />,
    );

    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeTruthy();
  });

  it("links ancestor steps and marks the current page", () => {
    render(
      <Breadcrumb
        items={[
          { label: "Home", href: "/" },
          { label: "Organizations" },
        ]}
      />,
    );

    const home = screen.getByRole("link", { name: "Home" });
    expect(home.getAttribute("href")).toBe("/");

    const current = screen.getByText("Organizations");
    expect(current.closest("[aria-current='page']")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Organizations" })).toBeNull();
  });
});
