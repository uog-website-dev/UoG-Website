import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { pageFromResponse } from "./public-page";
import {
  EMPTY_SITE,
  pageMetadata,
  PUBLIC_CACHE_MODE,
  PUBLIC_CACHE_SLA,
  publicFetchInit,
  safePagePath,
  sameSite,
  siteFromContext,
  websitePathFromRedirect,
} from "./public-site";
import { PublicSiteFrame } from "./public-site-frame";

const informatics = {
  site: { id: 2, code: "INFORMATICS", name: "Informatics" },
  configuration: { display_name: "College of Informatics", theme: "institutional" },
  modules: ["PAGES", "POSTS", "MENUS"],
};

const medicine = {
  site: { id: 3, code: "MEDICINE", name: "Medicine" },
  configuration: { display_name: "College of Medicine", theme: "high-contrast" },
  modules: ["PAGES", "MENUS"],
};

const main = {
  site: { id: 1, code: "MAIN", name: "University of Gondar" },
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
