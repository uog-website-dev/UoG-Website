import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ViewPublicSite } from "./view-public-site";

describe("ViewPublicSite", () => {
  it("links an active Site to the API hostname in a separate safe tab", () => {
    render(
      <ViewPublicSite
        siteName="Informatics"
        siteStatus="ACTIVE"
        primaryDomain={{ hostname: "informatics.uog.local", status: "ACTIVE" }}
      />,
    );

    const link = screen.getByRole("link", { name: "View Public Website for Informatics at informatics.uog.local" });
    expect(link.getAttribute("href")).toBe("//informatics.uog.local/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText("informatics.uog.local")).toBeTruthy();
  });

  it("explains when no usable primary hostname is configured", () => {
    render(<ViewPublicSite siteName="Main Site" siteStatus="ACTIVE" primaryDomain={null} />);

    expect(screen.getByText(/no usable primary hostname/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "View Public Website for Main Site" }).getAttribute("href")).toBeNull();
  });

  it("rejects malformed and inactive domains", () => {
    const { rerender } = render(
      <ViewPublicSite
        siteName="Site"
        siteStatus="ACTIVE"
        primaryDomain={{ hostname: "https://evil.example/path", status: "ACTIVE" }}
      />,
    );
    expect(screen.getByRole("button", { name: "View Public Website for Site at https://evil.example/path" }).getAttribute("href")).toBeNull();

    rerender(
      <ViewPublicSite
        siteName="Site"
        siteStatus="ACTIVE"
        primaryDomain={{ hostname: "site.uog.local", status: "INACTIVE" }}
      />,
    );
    expect(screen.getByText(/primary hostname is inactive/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "View Public Website for Site at site.uog.local" }).getAttribute("href")).toBeNull();
  });
});
