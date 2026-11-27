import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteEventRecord } from "@uog/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("tab=overview"),
}));

vi.mock("@uog/ui", async () => {
  const actual = await vi.importActual<typeof import("@uog/ui")>("@uog/ui");
  return {
    ...actual,
    usePublicSiteBranding: () => ({
      id: 11,
      name: "Detail Site",
      modules: { pages: true, posts: true, menus: true, documents: false, events: true, staffDirectory: false },
    }),
    publicFetchInit: () => ({ cache: "no-store" as RequestCache }),
  };
});

import { PublicEventDetailPage } from "./public-event-detail";

const event: SiteEventRecord = {
  id: "11111111-1111-1111-1111-111111111111",
  site: 11,
  title: "Research Symposium",
  slug: "research-symposium",
  summary: "Campus research day",
  description: "<p>Open sessions across tracks.</p>",
  category: null,
  category_name: "Research",
  organizer_name: "Research Office",
  contact_name: "Research Office",
  status: "PUBLISHED",
  lifecycle: "UPCOMING",
  starts_at: "2026-12-01T08:00:00Z",
  ends_at: "2026-12-02T16:00:00Z",
  timezone: "Africa/Addis_Ababa",
  venue: "Innovation Hall",
  format: "PHYSICAL",
  online_url: "",
  banner_asset: null,
  banner_url: null,
  registration_required: true,
  registration_capacity: 100,
  registration_open: true,
  accepts_registration: false,
  cancellation_notice: "",
  published_at: "2026-11-01T00:00:00Z",
  cancelled_at: null,
  version: 2,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
  sections: {
    overview: true,
    schedule: true,
    speakers: true,
    gallery: false,
    resources: false,
    updates: false,
  },
};

describe("PublicEventDetailPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("renders brand-critical Event identity and hides empty section tabs", () => {
    render(<PublicEventDetailPage slug={event.slug} initialEvent={event} />);
    expect(screen.getByRole("heading", { level: 1, name: "Research Symposium" })).toBeTruthy();
    expect(screen.getByText(/Innovation Hall/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Submit registration|Register/i })).toBeNull();
    expect(screen.getByRole("tab", { name: "Overview" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Schedule & Sessions" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Speakers" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /Gallery/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Resources/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Updates/i })).toBeNull();
  });

  it("exposes WCAG-oriented tablist and tabpanel landmarks", () => {
    render(<PublicEventDetailPage slug={event.slug} initialEvent={event} />);
    expect(screen.getByRole("tablist", { name: "Event sections" })).toBeTruthy();
    const overview = screen.getByRole("tab", { name: "Overview" });
    expect(overview.getAttribute("aria-controls")).toBe("event-panel-overview");
    expect(overview.getAttribute("id")).toBe("event-tab-overview");
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("id")).toBe("event-panel-overview");
    expect(panel.getAttribute("aria-labelledby")).toBe("event-tab-overview");
  });

  it("announces important notices with an accessible region", () => {
    render(
      <PublicEventDetailPage
        slug={event.slug}
        initialEvent={{
          ...event,
          sections: { ...event.sections!, updates: true },
          notices: [{
            id: "44444444-4444-4444-4444-444444444444",
            title: "Venue moved",
            body: "<p>Now in Hall B</p>",
            severity: "IMPORTANT",
            pinned: true,
            published_at: "2026-11-20T10:00:00Z",
          }],
        }}
      />,
    );
    expect(screen.getByLabelText("Important Event notices")).toBeTruthy();
    expect(screen.getByText("Venue moved")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Updates" })).toBeTruthy();
  });

  it("shows cancellation and disables registration CTA", () => {
    render(
      <PublicEventDetailPage
        slug="cancelled-day"
        initialEvent={{
          ...event,
          slug: "cancelled-day",
          status: "CANCELLED",
          accepts_registration: false,
          registration_open: false,
          cancellation_notice: "Moved to next term.",
          sections: { overview: true, schedule: false, speakers: false, gallery: false, resources: false, updates: false },
        }}
      />,
    );
    expect(screen.getByText(/This Event has been cancelled/)).toBeTruthy();
    expect(screen.getByText(/Moved to next term/)).toBeTruthy();
    expect(screen.queryByLabelText("Event registration")).toBeNull();
    expect(screen.queryByRole("tab", { name: "Schedule & Sessions" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Speakers" })).toBeNull();
  });
});
