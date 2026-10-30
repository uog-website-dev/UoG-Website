import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { pageFromResponse, paragraphParts, PublicPageView } from "./public-page";

const published = {
  status: "PUBLISHED",
  title: "Admissions",
  path: "/admissions",
  site: 11,
  blocks: [
    { type: "heading", level: 2, text: "Apply" },
    {
      type: "paragraph",
      html: "<p>Hello<script>alert(1)</script> <a href=\"javascript:alert(2)\">Bad</a> <a href=\"/about\">About</a></p>",
    },
    { type: "button", label: "Blocked", href: "javascript:alert(3)" },
    { type: "button", label: "Portal", href: "https://portal.example.edu/apply" },
  ],
  otherSite: { title: "Hospital" },
};

describe("pageFromResponse", () => {
  it("reads one published page and ignores a disabled module", () => {
    const page = pageFromResponse(200, published);
    expect(page?.title).toBe("Admissions");
    expect(page?.path).toBe("/admissions");
    expect(pageFromResponse(404, { error: { code: "not_found" } })).toBeNull();
    expect(pageFromResponse(200, { ...published, status: "DRAFT", title: "Secret" })).toBeNull();
  });
});

describe("paragraphParts", () => {
  it("drops script and javascript targets", () => {
    const html = published.blocks[1]?.html ?? "";
    const parts = paragraphParts(html);
    expect(parts.some((part) => part.type === "link" && part.label === "Bad")).toBe(false);
    expect(parts.find((part) => part.type === "link" && part.label === "About")).toMatchObject({
      href: "/about",
    });
    expect(JSON.stringify(parts)).not.toContain("<script");
    expect(JSON.stringify(parts)).not.toContain("javascript:");
  });
});

describe("PublicPageView", () => {
  it("renders the published page and does not mount unsafe markup", () => {
    const { container } = render(<PublicPageView page={pageFromResponse(200, published)} />);
    expect(screen.getByRole("heading", { level: 1, name: "Admissions" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "About" }).getAttribute("href")).toBe("/about");
    expect(screen.getByRole("link", { name: "Portal" }).getAttribute("href")).toBe("https://portal.example.edu/apply");
    expect(screen.queryByRole("link", { name: "Bad" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Blocked" })).toBeNull();
    expect(screen.getByText("Blocked").tagName).not.toBe("A");
    expect(container.querySelector("script")).toBeNull();
    expect(container.innerHTML).not.toContain("javascript:");
    expect(screen.queryByText("Hospital")).toBeNull();
  });

  it("lets a keyboard user reach a safe link", async () => {
    const user = userEvent.setup();
    render(<PublicPageView page={pageFromResponse(200, published)} />);
    const about = screen.getByRole("link", { name: "About" });
    await user.tab();
    expect(document.activeElement === about || about.matches(":focus-visible, :focus")).toBe(true);
  });

  it("states that a missing or unpublished page is not shown", () => {
    render(<PublicPageView page={null} />);
    expect(screen.getByRole("status").textContent).toMatch(/no published page/i);
  });
});
