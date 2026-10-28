import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DomainRecord, Site, SiteDomain } from "@uog/types";
import { ToastProvider } from "@uog/ui";

// --- server action mocks -------------------------------------------------
const createSiteDomain = vi.fn();
const updateSiteDomain = vi.fn();
const makeSiteDomainPrimary = vi.fn();
const listSiteDomains = vi.fn();

vi.mock("@/app/sites/actions", () => ({
  createSiteDomain: (...args: unknown[]) => createSiteDomain(...args),
  updateSiteDomain: (...args: unknown[]) => updateSiteDomain(...args),
  makeSiteDomainPrimary: (...args: unknown[]) => makeSiteDomainPrimary(...args),
  listSiteDomains: (...args: unknown[]) => listSiteDomains(...args),
}));

import { DomainFormDialog } from "./domain-form-dialog";

const STAMP = "2026-01-01T00:00:00Z";

function site(partial: Partial<Site>): Site {
  return {
    id: 1,
    code: "UOG_MAIN",
    name: "University of Gondar",
    short_name: "UoG",
    organization_unit: 1,
    default_language: "en",
    status: "ACTIVE",
    is_main: true,
    template: null,
    configuration: { schema_version: 1 } as Site["configuration"],
    created_at: STAMP,
    updated_at: STAMP,
    ...partial,
  };
}

function domainRecord(partial: Partial<DomainRecord>): DomainRecord {
  return {
    id: 10,
    site: 1,
    hostname: "www.uog.edu.et",
    is_primary: true,
    redirect_to_primary: false,
    status: "ACTIVE",
    created_at: STAMP,
    updated_at: STAMP,
    site_code: "UOG_MAIN",
    site_name: "University of Gondar",
    site_status: "ACTIVE",
    organization_unit: 1,
    ...partial,
  };
}

const SITES = [
  site({}),
  site({
    id: 2,
    code: "UOG_PRESS",
    name: "University Press",
    is_main: false,
    organization_unit: 4,
  }),
];

/** A domain page: by default the site's primary is `www.uog.edu.et`. */
function domainPage(hostname: string | null = "www.uog.edu.et") {
  return {
    ok: true,
    data: {
      count: hostname ? 1 : 0,
      next: null,
      previous: null,
      results: hostname
        ? [
            {
              id: 10,
              site: 1,
              hostname,
              is_primary: true,
              redirect_to_primary: false,
              status: "ACTIVE",
              created_at: STAMP,
              updated_at: STAMP,
            } satisfies SiteDomain,
          ]
        : [],
    },
  } as const;
}

function tagged(partial: Partial<SiteDomain> = {}) {
  const row: SiteDomain = {
    id: 99,
    site: 1,
    hostname: "new.uog.edu.et",
    is_primary: false,
    redirect_to_primary: false,
    status: "ACTIVE",
    created_at: STAMP,
    updated_at: STAMP,
    ...partial,
  };
  return { ok: true, etag: '"e1"', data: { data: row, etag: '"e1"', requestId: "req-1" } } as const;
}

function renderDialog(
  props: Partial<React.ComponentProps<typeof DomainFormDialog>> = {},
) {
  return render(
    <ToastProvider>
      <DomainFormDialog
        open
        record={null}
        sites={SITES}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        {...props}
      />
    </ToastProvider>,
  );
}

/**
 * Pick an option in the shared `SelectFilter` — a non-native MUI Select is a
 * combobox, driven by opening the listbox with a mouseDown and clicking the
 * option that appears.
 */
async function pickOption(name: RegExp, option: RegExp | string) {
  fireEvent.mouseDown(screen.getByRole("combobox", { name }));
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

beforeEach(() => {
  vi.clearAllMocks();
  listSiteDomains.mockResolvedValue(domainPage());
});

describe("DomainFormDialog — add", () => {
  it("shows the selected site and its existing primary domain", async () => {
    renderDialog();

    expect(screen.getByRole("dialog", { name: /Add domain/i })).toBeTruthy();
    // The selected Site is clearly displayed.
    expect(screen.getByText(/UOG_MAIN — University of Gondar/)).toBeTruthy();
    // Existing primary information is visible.
    await waitFor(() =>
      expect(screen.getByText("www.uog.edu.et")).toBeTruthy(),
    );
    expect(listSiteDomains).toHaveBeenCalledWith(1, { is_primary: true });
  });

  it("validates required fields and rejects invalid hostnames without an API call", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Add domain" }));

    const summary = await screen.findByRole("alert", {
      name: /check the form/i,
    });
    expect(summary.textContent).toMatch(/hostname/i);
    expect(createSiteDomain).not.toHaveBeenCalled();

    // A protocol/path value is rejected with the backend's wording.
    fireEvent.change(screen.getByLabelText(/Hostname/i), {
      target: { value: "https://uog.edu.et/path" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add domain" }));
    await waitFor(() =>
      expect(
        screen.getAllByText(/hostnames, not URLs or paths/i).length,
      ).toBeGreaterThan(0),
    );
    expect(createSiteDomain).not.toHaveBeenCalled();
  });

  it("normalizes the hostname, creates the domain and refreshes the listing", async () => {
    createSiteDomain.mockResolvedValue(tagged());

    const onSaved = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onSaved, onClose });

    fireEvent.change(screen.getByLabelText(/Hostname/i), {
      target: { value: "  ETH.UoG.Edu.et.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add domain" }));

    await waitFor(() => expect(createSiteDomain).toHaveBeenCalledTimes(1));
    expect(createSiteDomain).toHaveBeenCalledWith(1, {
      hostname: "eth.uog.edu.et",
      status: "ACTIVE",
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(await screen.findByText(/Added eth.uog.edu.et/i)).toBeTruthy();
  });

  it("displays a duplicate-hostname 409 on the hostname field and preserves input", async () => {
    createSiteDomain.mockResolvedValue({
      ok: false,
      error: {
        status: 409,
        code: "conflict",
        message: "The request conflicts with the current resource state.",
        details: {
          hostname: ["Site domain with this hostname already exists."],
        },
        requestId: "req-dup",
      },
    });

    const onSaved = vi.fn();
    renderDialog({ onSaved });

    const input = screen.getByLabelText(/Hostname/i);
    fireEvent.change(input, { target: { value: "www.uog.edu.et" } });
    fireEvent.click(screen.getByRole("button", { name: "Add domain" }));

    const summary = await screen.findByRole("alert", {
      name: /check the form/i,
    });
    await waitFor(() =>
      expect(summary.textContent).toMatch(/already exists/i),
    );
    // Failed submissions preserve entered form data.
    expect((input as HTMLInputElement).value).toBe("www.uog.edu.et");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("maps a backend 400 onto the offending field", async () => {
    createSiteDomain.mockResolvedValue({
      ok: false,
      error: {
        status: 400,
        code: "validation_error",
        message: "The request is invalid.",
        details: { status: ["An archived site cannot host an active domain."] },
        requestId: "req-400",
      },
    });

    renderDialog();
    fireEvent.change(screen.getByLabelText(/Hostname/i), {
      target: { value: "draft.uog.edu.et" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add domain" }));

    const summary = await screen.findByRole("alert", {
      name: /check the form/i,
    });
    await waitFor(() =>
      expect(summary.textContent).toMatch(/archived site/i),
    );
    expect(summary.textContent).toMatch(/status/i);
  });

  it("surfaces an unauthorized write instead of pretending success", async () => {
    createSiteDomain.mockResolvedValue({
      ok: false,
      error: {
        status: 403,
        code: "permission_denied",
        message: "You do not have permission to perform this action.",
        details: null,
        requestId: "req-403",
      },
    });

    const onSaved = vi.fn();
    renderDialog({ onSaved });
    fireEvent.change(screen.getByLabelText(/Hostname/i), {
      target: { value: "denied.uog.edu.et" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add domain" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/not enabled/i),
    );
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("blocks duplicate submissions while a request is in flight", async () => {
    let release: (value: unknown) => void = () => {};
    createSiteDomain.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    renderDialog();
    fireEvent.change(screen.getByLabelText(/Hostname/i), {
      target: { value: "slow.uog.edu.et" },
    });
    const submit = screen.getByRole("button", { name: "Add domain" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /working/i })).toBeTruthy(),
    );
    expect(createSiteDomain).toHaveBeenCalledTimes(1);

    release(tagged());
    await waitFor(() => expect(createSiteDomain).toHaveBeenCalledTimes(1));
  });
});

describe("DomainFormDialog — primary change confirmation", () => {
  it("confirms before promoting an alias to primary, naming the displaced domain", async () => {
    // Editing an alias; the site already has a different primary.
    listSiteDomains.mockResolvedValue(domainPage("www.uog.edu.et"));
    makeSiteDomainPrimary.mockResolvedValue(
      tagged({ is_primary: true, hostname: "alias.uog.edu.et" }),
    );

    const record = domainRecord({
      id: 11,
      hostname: "alias.uog.edu.et",
      is_primary: false,
    });
    const onSaved = vi.fn();
    renderDialog({ record, onSaved });

    await pickOption(/Domain type/i, /^Primary$/);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    // Confirmation is required before the mutation runs.
    const confirm = await screen.findByRole("dialog", {
      name: /primary domain\?/i,
    });
    expect(confirm.textContent).toMatch(/www\.uog\.edu\.et/);
    expect(makeSiteDomainPrimary).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Change primary" }));
    await waitFor(() =>
      expect(makeSiteDomainPrimary).toHaveBeenCalledWith(1, 11),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("does not promote when the confirmation is cancelled", async () => {
    listSiteDomains.mockResolvedValue(domainPage("www.uog.edu.et"));
    const record = domainRecord({
      id: 11,
      hostname: "alias.uog.edu.et",
      is_primary: false,
    });
    renderDialog({ record });

    await pickOption(/Domain type/i, /^Primary$/);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const confirm = await screen.findByRole("dialog", {
      name: /primary domain\?/i,
    });
    expect(confirm).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(makeSiteDomainPrimary).not.toHaveBeenCalled();
  });
});

describe("DomainFormDialog — edit", () => {
  it("locks hostname and Site, and saves a status change conditionally", async () => {
    updateSiteDomain.mockResolvedValue(
      tagged({ status: "INACTIVE" }),
    );

    const record = domainRecord({});
    const onSaved = vi.fn();
    renderDialog({ record, onSaved });

    expect(screen.getByRole("dialog", { name: /Edit domain/i })).toBeTruthy();
    // Hostname and Site are immutable — the fields say so.
    expect((screen.getByLabelText(/Hostname/i) as HTMLInputElement).disabled).toBe(true);
    // MUI marks a disabled select with aria-disabled on its display node.
    expect(
      screen.getByRole("combobox", { name: /Associated site/i }).getAttribute("aria-disabled"),
    ).toBe("true");

    await pickOption(/^Status$/i, "Inactive");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateSiteDomain).toHaveBeenCalledWith(1, 10, {
        status: "INACTIVE",
      }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("keeps the dialog open with entered data when the update fails", async () => {
    updateSiteDomain.mockResolvedValue({
      ok: false,
      error: {
        status: 412,
        code: "precondition_failed",
        message: "The resource changed. Retrieve it and reconcile your changes.",
        details: null,
        requestId: "req-412",
      },
    });

    renderDialog({ record: domainRecord({}) });
    await pickOption(/^Status$/i, "Inactive");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /changed since you opened it/i,
      ),
    );
    // The dialog stays open so the operator can reload and retry.
    expect(screen.getByRole("dialog", { name: /Edit domain/i })).toBeTruthy();
  });

  it("reports no changes instead of calling the API when nothing was edited", async () => {
    renderDialog({ record: domainRecord({}) });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText(/No changes to save/i)).toBeTruthy();
    expect(updateSiteDomain).not.toHaveBeenCalled();
    expect(makeSiteDomainPrimary).not.toHaveBeenCalled();
  });
});
