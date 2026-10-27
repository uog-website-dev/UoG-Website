import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Site } from "@uog/types";

import { ToastProvider } from "@uog/ui";

// --- server action mocks -------------------------------------------------
const createSite = vi.fn();
const updateSite = vi.fn();
const updateSiteConfiguration = vi.fn();
const getSite = vi.fn();
const getSiteTemplate = vi.fn();
const listSiteTemplates = vi.fn();
const getOrganizationTree = vi.fn();

vi.mock("@/app/sites/actions", () => ({
  createSite: (...args: unknown[]) => createSite(...args),
  updateSite: (...args: unknown[]) => updateSite(...args),
  updateSiteConfiguration: (...args: unknown[]) => updateSiteConfiguration(...args),
  getSite: (...args: unknown[]) => getSite(...args),
  getSiteTemplate: (...args: unknown[]) => getSiteTemplate(...args),
  listSiteTemplates: (...args: unknown[]) => listSiteTemplates(...args),
}));

vi.mock("@/app/organizations/actions", () => ({
  getOrganizationTree: (...args: unknown[]) => getOrganizationTree(...args),
}));

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

import { SiteForm } from "./site-form";

function site(partial: Partial<Site> = {}): Site {
  return {
    id: 5,
    code: "COI_PORTAL",
    name: "College of Informatics",
    short_name: "CoI",
    organization_unit: 2,
    default_language: "en",
    status: "DRAFT",
    is_main: false,
    template: null,
    configuration: {
      schema_version: 1,
      identity: { display_name: null, logo_ref: null, favicon_ref: null },
      language: { enabled: ["en", "am"] },
      presentation: { theme: "institutional" },
      navigation: { items: [] },
      behavior: { show_search: false, show_language_switcher: false },
    },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

function renderForm(props: { site?: Site | null } = {}) {
  return render(
    <ToastProvider>
      <SiteForm site={props.site ?? null} />
    </ToastProvider>,
  );
}

/**
 * Pick an option in the shared `SelectFilter` — a non-native MUI Select is a
 * combobox, driven by opening the listbox with a mouseDown and clicking the
 * option that appears.
 */
async function pickOption(name: RegExp, option: string) {
  fireEvent.mouseDown(screen.getByRole("combobox", { name }));
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

beforeEach(() => {
  vi.clearAllMocks();
  getOrganizationTree.mockResolvedValue({
    ok: true,
    data: {
      count: 2,
      results: [
        {
          id: 1,
          code: "UOG",
          name: "University of Gondar",
          short_name: "",
          organization_type: "UNIVERSITY",
          parent: null,
          description: "",
          status: "ACTIVE",
          metadata: {},
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
        {
          id: 2,
          code: "INFORMATICS",
          name: "College of Informatics",
          short_name: "",
          organization_type: "COLLEGE",
          parent: 1,
          description: "",
          status: "ACTIVE",
          metadata: {},
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    },
  });
  listSiteTemplates.mockResolvedValue({
    ok: true,
    data: { count: 0, next: null, previous: null, results: [] },
  });
  getSiteTemplate.mockResolvedValue({
    ok: false,
    error: { status: 404, code: "not_found", message: "Nope.", details: null, requestId: null },
  });
});

describe("SiteForm — create", () => {
  it("renders labelled controls for the approved DTO fields", () => {
    renderForm();

    expect(screen.getByLabelText(/Code/)).toBeTruthy();
    expect(screen.getByLabelText(/^Name/)).toBeTruthy();
    expect(screen.getByLabelText(/Short name/)).toBeTruthy();
    expect(screen.getByLabelText(/Display name/)).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /Owning organization/ })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /Default language/ })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /Template/ })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /Theme/ })).toBeTruthy();
    expect(screen.getByText("Enabled languages")).toBeTruthy();
    const languageGroup = document.getElementById("site-enabled-languages");
    expect(languageGroup).toBeTruthy();
    const english = within(languageGroup as HTMLElement).getByLabelText(
      /English \(en\)/,
    ) as HTMLInputElement;
    const amharic = within(languageGroup as HTMLElement).getByLabelText(
      /Amharic \(am\)/,
    ) as HTMLInputElement;
    expect(english.checked).toBe(true);
    expect(amharic.checked).toBe(true);
    expect(screen.getByLabelText(/Show search box/)).toBeTruthy();
    expect(screen.getByLabelText(/Show language switcher/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Create site/i })).toBeTruthy();
  });

  it("gives usable client feedback and does not call the API when invalid", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /Create site/i }));

    const summary = await screen.findByRole("alert", { name: /check the form/i });
    expect(summary.textContent).toMatch(/code/i);
    expect(summary.textContent).toMatch(/name/i);
    expect(summary.textContent).toMatch(/organization_unit/i);
    expect(createSite).not.toHaveBeenCalled();
  });

  it("submits the approved payload on success and navigates to the new site", async () => {
    createSite.mockResolvedValue({
      ok: true,
      data: { data: site({ id: 9 }), etag: '"e"', requestId: "r" },
    });

    renderForm();
    fireEvent.change(screen.getByLabelText(/Code/i), { target: { value: "  coi_portal " } });
    fireEvent.change(screen.getByLabelText(/^Name/i), {
      target: { value: "Informatics portal" },
    });
    await pickOption(/Owning organization/i, "INFORMATICS — College of Informatics");

    fireEvent.click(screen.getByRole("button", { name: /Create site/i }));

    await waitFor(() => expect(createSite).toHaveBeenCalledTimes(1));
    const input = createSite.mock.calls[0][0] as {
      code: string;
      organization_unit: number;
      status?: string;
      configuration: { language: { enabled: string[] } };
    };
    // Code normalized, owner typed as an id, DRAFT never sent by the client,
    // and the typed configuration carries both platform languages.
    expect(input.code).toBe("COI_PORTAL");
    expect(input.organization_unit).toBe(2);
    expect(input.status).toBeUndefined();
    expect(input.configuration.language.enabled).toEqual(["en", "am"]);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/sites/9"));
  });

  it("shows the server's denial instead of pretending the write succeeded", async () => {
    createSite.mockResolvedValue({
      ok: false,
      error: {
        status: 403,
        code: "permission_denied",
        message: "Development writes are off.",
        details: null,
        requestId: "req-403",
      },
    });

    renderForm();
    fireEvent.change(screen.getByLabelText(/Code/i), { target: { value: "DENIED" } });
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: "Denied site" } });
    await pickOption(/Owning organization/i, "INFORMATICS — College of Informatics");
    fireEvent.click(screen.getByRole("button", { name: /Create site/i }));

    expect(
      await screen.findByText(/not enabled in this environment/i),
    ).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it("attaches a duplicate-code conflict to the offending field", async () => {
    createSite.mockResolvedValue({
      ok: false,
      error: {
        status: 409,
        code: "conflict",
        message: "The request conflicts with the current resource state.",
        details: { code: ["A Site with this code already exists."] },
        requestId: "req-409",
      },
    });

    renderForm();
    fireEvent.change(screen.getByLabelText(/Code/i), { target: { value: "DUPLICATE" } });
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: "Dup site" } });
    await pickOption(/Owning organization/i, "INFORMATICS — College of Informatics");
    fireEvent.click(screen.getByRole("button", { name: /Create site/i }));

    const summary = await screen.findByRole("alert", { name: /check the form/i });
    expect(summary.textContent).toMatch(/already exists/i);
  });
});

describe("SiteForm — edit", () => {
  it("does not write anything when nothing changed", async () => {
    renderForm({ site: site() });

    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() =>
      expect(screen.getByText("No changes to save.")).toBeTruthy(),
    );
    expect(updateSite).not.toHaveBeenCalled();
    expect(updateSiteConfiguration).not.toHaveBeenCalled();
    expect(getSite).not.toHaveBeenCalled();
  });

  it("merges configuration first with a fresh ETag, then saves details", async () => {
    getSite.mockResolvedValue({
      ok: true,
      data: { data: site(), etag: '"e1"', requestId: "r" },
    });
    updateSiteConfiguration.mockResolvedValue({
      ok: true,
      data: { data: site(), etag: '"e2"', requestId: "r" },
    });
    updateSite.mockResolvedValue({
      ok: true,
      data: { data: site({ name: "Renamed" }), etag: '"e3"', requestId: "r" },
    });

    renderForm({ site: site() });
    fireEvent.change(screen.getByLabelText(/^Name/i), {
      target: { value: "Renamed" },
    });
    // Also change a typed configuration field so both writes are exercised.
    fireEvent.click(screen.getByLabelText(/Show search box/));
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => expect(updateSite).toHaveBeenCalledTimes(1));
    expect(getSite).toHaveBeenCalledWith(5);
    expect(updateSiteConfiguration).toHaveBeenCalledTimes(1);
    // Configuration first (so a new default language is enabled), with the
    // ETag returned by that merge.
    expect(updateSiteConfiguration.mock.calls[0][0]).toBe(5);
    expect(updateSiteConfiguration.mock.calls[0][1]).toBe('"e1"');
    expect(updateSite.mock.calls[0]).toEqual([
      5,
      '"e2"',
      expect.objectContaining({ name: "Renamed" }),
    ]);
    expect(
      updateSiteConfiguration.mock.invocationCallOrder[0],
    ).toBeLessThan(updateSite.mock.invocationCallOrder[0]);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/sites/5"));
  });

  it("locks frozen controls on an archived site", () => {
    renderForm({ site: site({ status: "ARCHIVED" }) });

    const mainCheckbox = screen.getByRole(
      "checkbox",
      { name: /Main university site/ },
    ) as HTMLInputElement;
    expect(mainCheckbox.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /Create site/i })).toBeNull();
    // Archived sites still allow corrections to name and settings.
    const nameInput = screen.getByLabelText(/^Name/) as HTMLInputElement;
    expect(nameInput.disabled).toBe(false);
    expect(screen.getByRole("button", { name: /Save changes/i })).toBeTruthy();
  });
});
