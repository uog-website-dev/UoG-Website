import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { publicPreviewHostname, ViewPublicSite } from "./view-public-site";

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

    expect(screen.getByText(/no usable active hostname/i)).toBeTruthy();
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
    expect(screen.getByRole("button", { name: "View Public Website for Site" }).getAttribute("href")).toBeNull();
    expect(screen.getByText(/no usable active hostname/i)).toBeTruthy();

    rerender(
      <ViewPublicSite
        siteName="Site"
        siteStatus="ACTIVE"
        primaryDomain={{ hostname: "site.uog.local", status: "INACTIVE" }}
      />,
    );
    expect(screen.getByText(/no usable active hostname/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "View Public Website for Site" }).getAttribute("href")).toBeNull();
  });

  it("prefers an ACTIVE *.uog.local alias while browsing the Admin Console locally", async () => {
    expect(
      publicPreviewHostname(
        { hostname: "coi.uog.edu.et", status: "ACTIVE" },
        [{ hostname: "coi.uog.local", status: "ACTIVE" }],
        true,
      ),
    ).toBe("coi.uog.local");

    render(
      <ViewPublicSite
        siteName="COI"
        siteStatus="ACTIVE"
        primaryDomain={{ hostname: "coi.uog.edu.et", status: "ACTIVE" }}
        domains={[{ hostname: "coi.uog.local", status: "ACTIVE" }]}
      />,
    );
    await waitFor(() => {
      const link = screen.getByRole("link", { name: /View Public Website for COI at coi\.uog\.local/i });
      expect(link.getAttribute("href")).toBe("//coi.uog.local/");
    });
  });

  it("explains how to preview when only a production hostname exists locally", async () => {
    render(
      <ViewPublicSite
        siteName="COI"
        siteStatus="ACTIVE"
        primaryDomain={{ hostname: "coi.uog.edu.et", status: "ACTIVE" }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/Add an ACTIVE domain such as coi\.uog\.local/i)).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /View Public Website for COI/i }).getAttribute("href")).toBeNull();
  });
});
