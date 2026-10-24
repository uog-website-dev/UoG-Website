import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Organization } from "@uog/types";

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

import { OrganizationDetail } from "./organization-detail";
import OrganizationLoading from "./loading";

const organization: Organization = {
  id: 23,
  code: "LIB",
  name: "University Library",
  short_name: "Library",
  organization_type: "COLLEGE",
  parent: 999,
  description: "Library services.",
  status: "ACTIVE",
  metadata: {},
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-02-01T00:00:00Z",
};

describe("organization detail screen", () => {
  it("shows approved organization fields and does not assume parent details are accessible", () => {
    render(<OrganizationDetail organization={organization} />);

    expect(screen.getByRole("heading", { name: "University Library" })).toBeTruthy();
    expect(screen.getAllByText("LIB")).toHaveLength(2);
    expect(screen.getByText("College")).toBeTruthy();
    expect(screen.getByText("Unit #999")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Library services.")).toBeTruthy();
    expect(screen.getByText("Jan 1, 2026, 12:00 AM")).toBeTruthy();
    expect(screen.getByText("Feb 1, 2026, 12:00 AM")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Edit organization" }).getAttribute("href")).toBe(
      "/organizations/23/edit",
    );
  });

  it("renders a retryable error with the server reference id", () => {
    render(
      <OrganizationDetail
        organization={null}
        error={{
          status: 403,
          code: "permission_denied",
          message: "You do not have permission to perform this action.",
          details: null,
          requestId: "request-23",
        }}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("request-23");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("explains a 404 as unavailable without showing the generic not-found page", () => {
    render(
      <OrganizationDetail
        organization={null}
        error={{
          status: 404,
          code: "not_found",
          message: "The requested resource was not found.",
          details: null,
          requestId: "request-missing",
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Organization unavailable" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Page not found" })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to organizations" }).getAttribute("href")).toBe(
      "/organizations",
    );
    expect(screen.getByText(/may no longer exist or may not be available/i)).toBeTruthy();
  });

  it("renders the route loading state", () => {
    render(<OrganizationLoading />);
    expect(screen.getByRole("status").textContent).toContain(
      "Loading organization details",
    );
  });
});
