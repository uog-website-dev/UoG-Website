import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import {
  ContentBanner,
  crumbsForPostDetail,
  crumbsFromPagePath,
} from "./content-banner";
import {
  DEFAULT_PUBLIC_BANNER_STYLE,
  resolveContentBannerStyle,
} from "./content-banner-model";

it("resolves shared global banner styles for pages and posts", () => {
  const style = resolveContentBannerStyle(
    {
      scope: "shared",
      shared: { ...DEFAULT_PUBLIC_BANNER_STYLE, title_align: "center" },
      page: { ...DEFAULT_PUBLIC_BANNER_STYLE, title_align: "left" },
      post: { ...DEFAULT_PUBLIC_BANNER_STYLE, title_align: "right" },
    },
    "page",
  );
  expect(style.title_align).toBe("center");
});

it("prefers an item override over the Site default", () => {
  const style = resolveContentBannerStyle(
    undefined,
    "post",
    { ...DEFAULT_PUBLIC_BANNER_STYLE, enabled: false },
  );
  expect(style.enabled).toBe(false);
});

it("renders the title inside the public content banner", () => {
  render(
    <ContentBanner
      title="Campus news"
      titleId="public-post-title"
      style={DEFAULT_PUBLIC_BANNER_STYLE}
    />,
  );
  expect(screen.getByRole("heading", { level: 1, name: "Campus news" })).toBeTruthy();
  expect(screen.getByLabelText("Content banner")).toBeTruthy();
});

it("applies overlay color on pattern banners without tiling the wash", () => {
  const { container } = render(
    <ContentBanner
      title="Campus news"
      titleId="public-post-title"
      style={{
        ...DEFAULT_PUBLIC_BANNER_STYLE,
        background_type: "pattern",
        pattern: "geometric-grid",
        overlay_color: "#c9a227",
        overlay_opacity: 0.4,
      }}
    />,
  );
  const banner = container.querySelector('[data-content-banner="styled"]') as HTMLElement;
  const image = getComputedStyle(banner).backgroundImage;
  expect(image).toContain("rgba(201,162,39,0.4)");
  expect(getComputedStyle(banner).backgroundSize.startsWith("100% 100%")).toBe(true);
});

it("renders banner breadcrumbs above the title", () => {
  render(
    <ContentBanner
      title="Campus news"
      titleId="public-post-title"
      style={DEFAULT_PUBLIC_BANNER_STYLE}
      breadcrumbs={crumbsForPostDetail()}
    />,
  );
  const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
  expect(crumbs.textContent).toContain("News");
  expect(crumbs.textContent).toContain("Detail");
  expect(screen.getByRole("link", { name: "News" }).getAttribute("href")).toBe("/posts");
});

it("builds page path crumbs without duplicating Home", () => {
  expect(crumbsFromPagePath("/about/leadership")).toEqual([
    { label: "About", href: "/about" },
  ]);
  expect(crumbsFromPagePath("/about")).toEqual([]);
  expect(crumbsFromPagePath("/")).toEqual([]);
});

it("does not echo the page title as a banner crumb", () => {
  render(
    <ContentBanner
      title="Messege"
      titleId="public-page-title"
      style={DEFAULT_PUBLIC_BANNER_STYLE}
      breadcrumbs={[{ label: "Messege" }]}
    />,
  );
  expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
  expect(screen.getByRole("heading", { level: 1, name: "Messege" })).toBeTruthy();
});
