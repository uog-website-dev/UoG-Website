import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
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

import { AdminShell } from "@/admin-shell";

describe("AdminShell", () => {
  it("renders the console chrome around the page content", () => {
    render(
      <AdminShell actions={<span>Sign in</span>}>
        <p>Page content</p>
      </AdminShell>,
    );

    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByText("Page content")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Skip to main content" }),
    ).toBeTruthy();
    expect(screen.getByText("Sign in")).toBeTruthy();
    expect(
      screen.getAllByRole("navigation", { name: "Admin sections" }).length,
    ).toBe(1);
  });

  it("opens and closes the mobile navigation drawer from the header toggle", async () => {
    render(
      <AdminShell>
        <p>Page content</p>
      </AdminShell>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));

    // MUI v6 temporary Drawer: role="presentation" modal that aria-hides the
    // rest of the app — assert on the drawer paper content instead.
    const drawerPaper = document.querySelector(".MuiDrawer-paper");
    expect(drawerPaper).toBeTruthy();
    const drawer = within(drawerPaper as HTMLElement);
    expect(
      drawer.getByRole("navigation", { name: "Admin sections" }),
    ).toBeTruthy();
    expect(drawer.getByRole("link", { name: /Organizations/ })).toBeTruthy();
    expect(
      // The toggle lives in the app root, which the open Modal aria-hides.
      screen
        .getByRole("button", { name: "Open navigation menu", hidden: true })
        .getAttribute("aria-expanded"),
    ).toBe("true");

    fireEvent.click(drawer.getByRole("button", { name: "Close navigation menu" }));
    // The drawer unmounts after its exit transition.
    await waitFor(() =>
      expect(document.querySelector(".MuiDrawer-paper")).toBeNull(),
    );
  });
});
