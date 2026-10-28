import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PaginatedResponse,
  PlatformModule,
  Site,
  SiteModuleAssignment,
} from "@uog/types";
import { ToastProvider } from "@uog/ui";

// --- server action mocks -------------------------------------------------
const listPlatformModules = vi.fn();
const listSiteModuleAssignments = vi.fn();
const enableSiteModule = vi.fn();
const disableSiteModule = vi.fn();
const updateSiteModuleSettings = vi.fn();

vi.mock("@/app/sites/actions", () => ({
  listPlatformModules: (...args: unknown[]) => listPlatformModules(...args),
  listSiteModuleAssignments: (...args: unknown[]) =>
    listSiteModuleAssignments(...args),
  enableSiteModule: (...args: unknown[]) => enableSiteModule(...args),
  disableSiteModule: (...args: unknown[]) => disableSiteModule(...args),
  updateSiteModuleSettings: (...args: unknown[]) =>
    updateSiteModuleSettings(...args),
}));

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

import { SiteModules } from "./site-modules";

const STAMP = "2026-01-01T00:00:00Z";

function site(partial: Partial<Site> = {}): Site {
  return {
    id: 1,
    code: "UOG_MAIN",
    name: "University of Gondar",
    short_name: "UoG",
    organization_unit: 1,
    default_language: "en-us",
    status: "ACTIVE",
    is_main: true,
    template: null,
    configuration: {
      schema_version: 1,
      identity: { display_name: null, logo_ref: null, favicon_ref: null },
      language: { enabled: ["en-us"] },
      presentation: { theme: "institutional" },
      navigation: { items: [] },
      behavior: { show_search: false, show_language_switcher: false },
    },
    created_at: STAMP,
    updated_at: STAMP,
    ...partial,
  };
}

/** A shipped, globally enabled module with one required integer setting. */
function eventsModule(partial: Partial<PlatformModule> = {}): PlatformModule {
  return {
    id: 10,
    code: "EVENTS",
    name: "Events",
    description: "Calendar and events.",
    status: "IMPLEMENTED",
    is_enabled: true,
    configuration_schema: {
      schema_version: 1,
      properties: [
        {
          code: "PAGE_SIZE",
          label: "Page size",
          type: "integer",
          required: true,
        },
      ],
    },
    created_at: STAMP,
    updated_at: STAMP,
    ...partial,
  };
}

function plannedModule(partial: Partial<PlatformModule> = {}): PlatformModule {
  return eventsModule({
    id: 1,
    code: "CMS",
    name: "Content management",
    description: "Page authoring and publishing.",
    status: "PLANNED",
    is_enabled: false,
    configuration_schema: {},
    ...partial,
  });
}

function assignment(
  partial: Partial<SiteModuleAssignment> = {},
): SiteModuleAssignment {
  return {
    id: 5,
    site: 1,
    module: 10,
    is_enabled: true,
    configuration: { PAGE_SIZE: 20 },
    created_at: STAMP,
    updated_at: STAMP,
    ...partial,
  };
}

function page<T>(results: T[], count = results.length): PaginatedResponse<T> {
  return { count, next: null, previous: null, results };
}

function ok(data: unknown) {
  return { ok: true as const, data, etag: '"etag-1"' };
}

function failure(
  status: number,
  message: string,
  extra: Record<string, unknown> = {},
) {
  return {
    ok: false as const,
    error: {
      status,
      code: status === 403 ? "permission_denied" : "api_error",
      message,
      details: null,
      requestId: "req-1",
      ...extra,
    },
  };
}

function renderModules(props: { site?: Site | null }) {
  return render(
    <ToastProvider>
      <SiteModules site={props.site === undefined ? site() : props.site} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listPlatformModules.mockResolvedValue(ok(page([plannedModule()])));
  listSiteModuleAssignments.mockResolvedValue(ok(page([])));
});

describe("SiteModules — availability messaging", () => {
  it("shows a PLANNED module as unavailable with no enable control", async () => {
    renderModules({});

    expect(await screen.findByText(/CMS — Content management/)).toBeTruthy();
    expect(screen.getByText("Planned")).toBeTruthy();
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(
      screen.getByText(/registry row is not a working feature/i),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
  });

  it("shows an implemented module as available with an Enable control", async () => {
    listPlatformModules.mockResolvedValue(ok(page([eventsModule()])));

    renderModules({});

    expect(await screen.findByText("Available")).toBeTruthy();
    expect(
      screen.getByText(/implemented and enabled platform-wide/i),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enable" })).toBeTruthy();
  });

  it("explains a globally disabled module instead of offering it", async () => {
    listPlatformModules.mockResolvedValue(
      ok(page([eventsModule({ is_enabled: false })])),
    );

    renderModules({});

    expect(await screen.findByText(/switched off platform-wide/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
  });
});

describe("SiteModules — empty and error states", () => {
  it("says honestly that the registry is empty", async () => {
    listPlatformModules.mockResolvedValue(ok(page([])));

    renderModules({});

    expect(await screen.findByText("No modules registered")).toBeTruthy();
  });

  it("surfaces a failed registry read with a retry, not an empty list", async () => {
    listPlatformModules.mockResolvedValue(failure(500, "Boom."));

    renderModules({});

    expect(await screen.findByText("Module registry unavailable")).toBeTruthy();
    expect(screen.queryByText("No modules registered")).toBeNull();
  });

  it("hides the controls when the assignment read fails", async () => {
    listPlatformModules.mockResolvedValue(ok(page([eventsModule()])));
    listSiteModuleAssignments.mockResolvedValue(failure(500, "Boom."));

    renderModules({});

    expect(
      await screen.findByText(/module state for this site could not be loaded/i),
    ).toBeTruthy();
    expect(
      screen.getByText(/controls are hidden until this read succeeds/i),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
  });

  it("renders the unavailable card when the site itself is missing", async () => {
    render(
      <ToastProvider>
        <SiteModules
          site={null}
          error={{
            status: 404,
            code: "not_found",
            message: "No Site matches the given query.",
            details: null,
            requestId: null,
          }}
        />
      </ToastProvider>,
    );

    expect(await screen.findByText("Site unavailable")).toBeTruthy();
  });
});

describe("SiteModules — enabling", () => {
  it("opens the settings form first when the module has required settings", async () => {
    listPlatformModules.mockResolvedValue(ok(page([eventsModule()])));

    renderModules({});

    fireEvent.click(await screen.findByRole("button", { name: "Enable" }));

    // The form collects the required property before anything is written.
    expect(screen.getByLabelText(/Page size/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enable module" })).toBeTruthy();
    expect(enableSiteModule).not.toHaveBeenCalled();
  });

  it("blocks submit with a field error until the required setting is filled", async () => {
    listPlatformModules.mockResolvedValue(ok(page([eventsModule()])));

    renderModules({});

    fireEvent.click(await screen.findByRole("button", { name: "Enable" }));
    fireEvent.click(screen.getByRole("button", { name: "Enable module" }));

    // The message appears in the error summary and beside the field.
    expect(
      (await screen.findAllByText(/A value is required/)).length,
    ).toBeGreaterThan(0);
    expect(enableSiteModule).not.toHaveBeenCalled();
  });

  it("enables with settings and refreshes the module state on success", async () => {
    listPlatformModules.mockResolvedValue(ok(page([eventsModule()])));
    enableSiteModule.mockResolvedValue(ok(assignment({ is_enabled: true })));

    renderModules({});

    fireEvent.click(await screen.findByRole("button", { name: "Enable" }));
    fireEvent.change(screen.getByLabelText(/Page size/), {
      target: { value: "25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enable module" }));

    await waitFor(() =>
      expect(enableSiteModule).toHaveBeenCalledWith(1, 10, { PAGE_SIZE: 25 }),
    );
    await waitFor(() =>
      expect(listSiteModuleAssignments).toHaveBeenCalledTimes(2),
    );
    expect(
      await screen.findByText(/EVENTS enabled for University of Gondar/),
    ).toBeTruthy();
  });

  it("enables directly when the module has no settings to collect", async () => {
    listPlatformModules.mockResolvedValue(
      ok(
        page([
          eventsModule({
            configuration_schema: { schema_version: 1, properties: [] },
          }),
        ]),
      ),
    );
    enableSiteModule.mockResolvedValue(ok(assignment()));

    renderModules({});

    fireEvent.click(await screen.findByRole("button", { name: "Enable" }));

    await waitFor(() => expect(enableSiteModule).toHaveBeenCalledWith(1, 10));
  });

  it("displays a denied write verbatim and does not claim success", async () => {
    listPlatformModules.mockResolvedValue(
      ok(
        page([
          eventsModule({
            configuration_schema: { schema_version: 1, properties: [] },
          }),
        ]),
      ),
    );
    enableSiteModule.mockResolvedValue(
      failure(403, "Writing sites is not enabled."),
    );

    renderModules({});

    fireEvent.click(await screen.findByRole("button", { name: "Enable" }));

    expect(
      await screen.findByText(/Writing site modules is not enabled/i),
    ).toBeTruthy();
    expect(screen.getByText(/reference req-1/)).toBeTruthy();
    expect(
      screen.queryByText(/EVENTS enabled for University of Gondar/),
    ).toBeNull();
  });

  it("shows the server's field error inside the open settings panel", async () => {
    listPlatformModules.mockResolvedValue(ok(page([eventsModule()])));
    enableSiteModule.mockResolvedValue({
      ok: false,
      error: {
        status: 400,
        code: "validation_error",
        message: "The request is invalid.",
        details: {
          configuration: ["Site module configuration is not approved."],
        },
        requestId: "req-400",
      },
    });

    renderModules({});

    fireEvent.click(await screen.findByRole("button", { name: "Enable" }));
    fireEvent.change(screen.getByLabelText(/Page size/), {
      target: { value: "25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enable module" }));

    expect(
      await screen.findByText(/Site module configuration is not approved/),
    ).toBeTruthy();
    // The panel stays open so the operator can correct the value.
    expect(
      screen.getByRole("button", { name: "Enable module" }),
    ).toBeTruthy();
  });
});

describe("SiteModules — disabling and settings", () => {
  it("confirms before disabling and reports success with data preserved", async () => {
    listPlatformModules.mockResolvedValue(ok(page([eventsModule()])));
    listSiteModuleAssignments.mockResolvedValue(ok(page([assignment()])));
    disableSiteModule.mockResolvedValue(ok(assignment({ is_enabled: false })));

    renderModules({});

    fireEvent.click(await screen.findByRole("button", { name: "Disable" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/Disable this module for the site\?/),
    ).toBeTruthy();
    expect(within(dialog).getByText(/nothing is deleted/i)).toBeTruthy();
    expect(disableSiteModule).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Disable" }));

    await waitFor(() => expect(disableSiteModule).toHaveBeenCalledWith(1, 5));
    expect(await screen.findByText(/Its settings are kept/)).toBeTruthy();
  });

  it("surfaces a failed disable inside the dialog instead of closing it", async () => {
    listPlatformModules.mockResolvedValue(ok(page([eventsModule()])));
    listSiteModuleAssignments.mockResolvedValue(ok(page([assignment()])));
    disableSiteModule.mockResolvedValue(failure(412, "Stale."));

    renderModules({});

    fireEvent.click(await screen.findByRole("button", { name: "Disable" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Disable" }));

    expect(await within(dialog).findByText("Stale.")).toBeTruthy();
    expect(disableSiteModule).toHaveBeenCalledTimes(1);
  });

  it("saves settings through the PATCH action without toggling enablement", async () => {
    listPlatformModules.mockResolvedValue(ok(page([eventsModule()])));
    listSiteModuleAssignments.mockResolvedValue(ok(page([assignment()])));
    updateSiteModuleSettings.mockResolvedValue(ok(assignment()));

    renderModules({});

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.change(screen.getByLabelText(/Page size/), {
      target: { value: "50" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() =>
      expect(updateSiteModuleSettings).toHaveBeenCalledWith(1, 5, {
        PAGE_SIZE: 50,
      }),
    );
    expect(enableSiteModule).not.toHaveBeenCalled();
    expect(disableSiteModule).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/Settings saved for EVENTS/),
    ).toBeTruthy();
  });

  it("rejects a non-numeric setting locally before any request", async () => {
    listPlatformModules.mockResolvedValue(ok(page([eventsModule()])));
    listSiteModuleAssignments.mockResolvedValue(ok(page([assignment()])));

    renderModules({});

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.change(screen.getByLabelText(/Page size/), {
      target: { value: "many" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(
      (await screen.findAllByText(/Enter a whole number/)).length,
    ).toBeGreaterThan(0);
    expect(updateSiteModuleSettings).not.toHaveBeenCalled();
  });

  it("shows the stored settings summary for an assigned module", async () => {
    listPlatformModules.mockResolvedValue(ok(page([eventsModule()])));
    listSiteModuleAssignments.mockResolvedValue(ok(page([assignment()])));

    renderModules({});

    expect(await screen.findByText("PAGE_SIZE: 20")).toBeTruthy();
    expect(screen.getByText("Enabled on this site")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disable" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
  });
});
