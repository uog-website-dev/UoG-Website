import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { pageFromResponse, PublicPageView } from "./public-page";
import {
  EMPTY_SITE,
  menuPayloadForSite,
  pageMetadata,
  postMetadata,
  publicLogoSource,
  PUBLIC_CACHE_MODE,
  PUBLIC_CACHE_SLA,
  publicFetchInit,
  safePagePath,
  sameSite,
  siteFromContext,
  websitePathFromRedirect,
} from "./public-site";
import { PublicSiteFrame } from "./public-site-frame";
import { PublicSiteBrandingProvider } from "./site-branding";
import { SiteBrandingLockup, SiteBrandingMark } from "./site-branding";
import { UogFooter, UogHeader } from "./UogShell";

describe("host-scoped menu payloads", () => {
  const payload = { site: 2, locations: { header: [{ label: "About", href: "/about", children: [] }] }, configured_locations: ["header"] };

  it("accepts only the payload for the resolved Site", () => {
    expect(menuPayloadForSite(payload, 2)).toEqual(payload);
    expect(menuPayloadForSite(payload, 3)).toBeNull();
    expect(menuPayloadForSite({ ...payload, site: "2" }, 2)).toBeNull();
  });

  it("fails closed for missing Site ids and malformed locations", () => {
    expect(menuPayloadForSite(payload, null)).toBeNull();
    expect(menuPayloadForSite(null, 2)).toBeNull();
    expect(menuPayloadForSite({ site: 2 }, 2)).toBeNull();
    expect(menuPayloadForSite({ site: 2, locations: [] }, 2)).toBeNull();
  });
});

const informatics = {
  site: { id: 2, code: "INFORMATICS", name: "Informatics" },
  domain: "informatics.uog.edu.et",
  canonical_domain: "informatics.uog.edu.et",
  configuration: { ...{ display_name: "College of Informatics", theme: "institutional" }, logo_url: "/api/v1/site-context/identity/logo/" },
  modules: ["PAGES", "POSTS", "MENUS"],
};

const medicine = {
  site: { id: 3, code: "MEDICINE", name: "Medicine" },
  configuration: { display_name: "College of Medicine", theme: "high-contrast" },
  modules: ["PAGES", "MENUS"],
};

const main = {
  site: { id: 1, code: "MAIN", name: "University of Gondar" },
  domain: "uog.edu.et",
  canonical_domain: "uog.edu.et",
  configuration: { display_name: "University of Gondar", theme: "institutional" },
  modules: ["PAGES", "POSTS", "MENUS"],
};

describe("siteFromContext", () => {
  it("keeps three hostnames distinct and drops a failed context", () => {
    const hosts = [main, informatics, medicine].map((body) => siteFromContext(200, body));
    expect(hosts.map((site) => site.displayName)).toEqual([
      "University of Gondar",
      "College of Informatics",
      "College of Medicine",
    ]);
    expect(hosts.map((site) => site.id)).toEqual([1, 2, 3]);
    expect(hosts.map((site) => site.domain)).toEqual(["uog.edu.et", "informatics.uog.edu.et", null]);
    expect(hosts.map((site) => site.canonicalDomain)).toEqual(["uog.edu.et", "informatics.uog.edu.et", null]);
    expect(hosts[1]?.logoUrl).toBe("/api/v1/site-context/identity/logo/");
    expect(publicLogoSource(hosts[1]!)).toBe("/api/v1/site-context/identity/logo/");
    const versioned = siteFromContext(200, {
      ...informatics,
      configuration: { ...informatics.configuration, branding_revision: "b".repeat(64) },
    });
    expect(publicLogoSource(versioned)).toBe(`/api/v1/site-context/identity/logo/?v=${"b".repeat(64)}`);
    expect(hosts[2]?.logoUrl).toBeNull();
    expect(publicLogoSource(hosts[2]!)).toBeNull();
    expect(siteFromContext(200, { ...informatics, configuration: { ...informatics.configuration, logo_url: "https://private.example/logo.png" } }).logoUrl).toBeNull();
    expect(hosts[2]?.theme).toBe("high-contrast");
    expect(hosts[1]?.modules.posts).toBe(true);
    expect(hosts[2]?.modules.posts).toBe(false);
    expect(siteFromContext(404, { site: informatics.site })).toEqual(EMPTY_SITE);
    expect(siteFromContext(200, { site: null, modules: ["PAGES"] }).id).toBeNull();
  });
});

describe("public page policy", () => {
  it("rejects another Site, a draft, a bad path and a foreign redirect", () => {
    const page = pageFromResponse(200, {
      status: "PUBLISHED",
      title: "News",
      path: "/news",
      site: 2,
      seo: { meta_title: "Informatics news<script>", meta_description: "College news" },
      blocks: [],
    });
    expect(sameSite(page?.site ?? null, 2)).toBe(true);
    expect(sameSite(page?.site ?? null, 3)).toBe(false);
    expect(pageFromResponse(200, { status: "DRAFT", title: "Secret", path: "/news", site: 2 })).toBeNull();
    expect(safePagePath(["news"])).toBe("/news");
    expect(safePagePath(["../admin"])).toBeNull();
    expect(safePagePath(["NEWS"])).toBeNull();
    expect(websitePathFromRedirect("/api/v1/site-context/pages/news/")).toBe("/news");
    expect(websitePathFromRedirect("https://medicine.uog.local/api/v1/site-context/pages/news/")).toBe("/news");
    expect(websitePathFromRedirect("https://evil.example/steal")).toBeNull();
    expect(websitePathFromRedirect("/api/v1/sites/3/pages/news/")).toBeNull();
    const site = siteFromContext(200, informatics);
    expect(pageMetadata(site, page).title).toBe("Informatics news");
    expect(pageMetadata(site, page).description).toBe("College news");
    expect(pageMetadata(site, page).title).not.toContain("<script");
    expect(
      postMetadata(site, {
        title: "Campus update",
        excerpt: "Campus excerpt",
        seo: { title: "Campus SEO", description: "Campus description" },
      }).title,
    ).toBe("Campus SEO");
    expect(
      postMetadata(site, {
        title: "Campus update",
        excerpt: "Campus excerpt",
        seo: { title: "", description: "" },
      }).description,
    ).toBe("Campus excerpt");
  });

  it("revalidates on every read within the public cache SLA", () => {
    expect(PUBLIC_CACHE_SLA).toBe("public, max-age=0, must-revalidate");
    expect(publicFetchInit().cache).toBe(PUBLIC_CACHE_MODE);
    expect(publicFetchInit().redirect).toBe("manual");
  });
});

describe("PublicSiteFrame", () => {
  it("renders one Site and hides posts when that module is off", () => {
    const { rerender } = render(
      <PublicSiteFrame site={siteFromContext(200, informatics)}>
        <p>Informatics welcome</p>
      </PublicSiteFrame>,
    );
    expect(screen.getByRole("heading", { name: "College of Informatics" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Published posts" }).getAttribute("href")).toBe("/posts");
    expect(screen.queryByText("College of Medicine")).toBeNull();
    expect(document.querySelector("[data-theme='institutional']")).toBeTruthy();

    rerender(
      <PublicSiteFrame site={siteFromContext(200, medicine)}>
        <p>Medicine welcome</p>
      </PublicSiteFrame>,
    );
    expect(screen.getByRole("heading", { name: "College of Medicine" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Published posts" })).toBeNull();
    expect(screen.queryByText("Informatics welcome")).toBeNull();
    const frame = document.querySelector("[data-theme='high-contrast']");
    expect(frame).toBeTruthy();
    expect(frame?.getAttribute("data-site-code")).toBe("MEDICINE");
    const heading = screen.getByRole("heading", { name: "College of Medicine" });
    expect(heading.tagName).toBe("H1");
  });
});

describe("Site-bound Page and homepage branding", () => {
  it("keeps Site scope without repeating shell branding inside Page content", () => {
    const page = pageFromResponse(200, {
      status: "PUBLISHED",
      title: "About our college",
      path: "/about",
      site: 2,
      blocks: [{ type: "paragraph", html: "Our work" }],
      seo: {},
    });
    expect(page).not.toBeNull();
    const { rerender, container } = render(
      <PublicSiteBrandingProvider site={siteFromContext(200, informatics)}>
        <PublicPageView page={page} />
      </PublicSiteBrandingProvider>,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("heading", { name: "About our college" })).toBeTruthy();
    expect(container.querySelector('[data-site-code="INFORMATICS"]')).toBeTruthy();

    const medicinePage = { ...page!, site: 3 };
    rerender(
      <PublicSiteBrandingProvider site={siteFromContext(200, medicine)}>
        <PublicPageView page={medicinePage} />
      </PublicSiteBrandingProvider>,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector('[data-site-code="MEDICINE"]')).toBeTruthy();
    expect(container.querySelector('img[src="/api/v1/site-context/identity/logo/"]')).toBeNull();
  });

  it("uses one shared brand identity in public header and footer and safely falls back on logo failure", () => {
    const site = siteFromContext(200, informatics);
    const { container } = render(
      <>
        <UogHeader title={site.displayName} brand={<SiteBrandingMark site={site} />} />
        <UogFooter apiBaseUrl={undefined} brand={<SiteBrandingLockup site={site} compact />} />
      </>,
    );
    expect(container.querySelector("header img")?.getAttribute("src")).toBe(
      "/api/v1/site-context/identity/logo/",
    );
    expect(container.querySelector("footer [data-site-branding='INFORMATICS']")).toBeTruthy();
    fireEvent.error(container.querySelector("header img")!);
    expect(screen.getByRole("img", { name: "College of Informatics logo fallback" })).toBeTruthy();
    expect(container.querySelector("img[src*='private']")).toBeNull();
  });
});


it("shows the configured logo without a painted background or border", () => {
  render(<SiteBrandingLockup site={siteFromContext(200, informatics)} inverse />);
  const logo = screen.getByRole("img", {name: "College of Informatics logo"});
  const style = getComputedStyle(logo);
  expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(style.borderTopWidth).toBe("0px");
  expect(style.padding).toBe("");
});


it("reloads the host-scoped logo on a branding revision change and recovers from an earlier failure", () => {
  const first={...siteFromContext(200,informatics),brandingRevision:"a".repeat(64)};
  const {rerender}=render(<SiteBrandingMark site={first}/>);
  const image=screen.getByRole("img",{name:"College of Informatics logo"});
  expect(image.getAttribute("src")).toBe(`/api/v1/site-context/identity/logo/?v=${first.brandingRevision}`);
  fireEvent.error(image);
  expect(screen.getByRole("img",{name:/logo fallback/})).toBeTruthy();
  const next={...first,brandingRevision:"b".repeat(64)};
  rerender(<SiteBrandingMark site={next}/>);
  expect(screen.getByRole("img",{name:"College of Informatics logo"}).getAttribute("src")).toBe(`/api/v1/site-context/identity/logo/?v=${next.brandingRevision}`);
});


it("retries a transient logo failure on a successful refresh of the same branding revision",()=>{
  const site={...siteFromContext(200,informatics),brandingRevision:"a".repeat(64)};
  const {rerender}=render(<SiteBrandingMark site={site}/>);
  fireEvent.error(screen.getByRole("img",{name:"College of Informatics logo"}));
  expect(screen.getByRole("img",{name:/logo fallback/})).toBeTruthy();
  rerender(<SiteBrandingMark site={{...site}}/>);
  expect(screen.getByRole("img",{name:"College of Informatics logo"})).toBeTruthy();
});
