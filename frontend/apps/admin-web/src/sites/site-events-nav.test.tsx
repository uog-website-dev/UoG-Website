import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/sites/11/admin/events/settings",
}));

vi.mock("@/sites/site-admin-frame", () => ({
  useSiteAdmin: () => ({
    site: { id: 11, name: "Informatics" },
    enabledModuleCodes: ["EVENTS"],
    permissions: ["sites.update"],
  }),
}));

import { SiteEventsNav } from "./site-events-nav";
import { sectionDecision, sectionByKey, visibleSiteSections } from "./site-admin";

describe("Events navigation", () => {
  it("exposes All Events, Add New Event and Event Settings links", () => {
    render(
      <SiteEventsNav title="Event Settings" description="Configure Events for Informatics." />,
    );
    expect(screen.getByRole("navigation", { name: "Events" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "All Events" }).getAttribute("href")).toBe("/sites/11/admin/events");
    expect(screen.getByRole("link", { name: "Add New Event" }).getAttribute("href")).toBe("/sites/11/admin/events/new");
    expect(screen.getByRole("link", { name: "Event Settings" }).getAttribute("href")).toBe("/sites/11/admin/events/settings");
  });

  it("shows Events in the Site sidebar only when EVENTS is enabled for a Site Admin", () => {
    expect(sectionDecision(sectionByKey("events"), {
      enabledModuleCodes: ["EVENTS"],
      permissions: ["sites.update"],
    })).toBe("visible");
    expect(visibleSiteSections({
      enabledModuleCodes: ["PAGES"],
      permissions: ["sites.update"],
    }).map((section) => section.key)).not.toContain("events");
    expect(visibleSiteSections({
      enabledModuleCodes: ["EVENTS"],
      permissions: ["sites.update"],
    }).map((section) => section.key)).toContain("events");
  });
});
