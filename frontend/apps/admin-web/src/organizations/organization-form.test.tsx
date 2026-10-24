import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Organization } from "@uog/types";

import { ToastProvider } from "@uog/ui";

// --- server action mocks -------------------------------------------------
const createOrganization = vi.fn();
const updateOrganization = vi.fn();
const getOrganizationTree = vi.fn();

vi.mock("@/app/organizations/actions", () => ({
  createOrganization: (...args: unknown[]) => createOrganization(...args),
  updateOrganization: (...args: unknown[]) => updateOrganization(...args),
  getOrganizationTree: (...args: unknown[]) => getOrganizationTree(...args),
}));

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

import { OrganizationForm } from "./organization-form";

function org(partial: Partial<Organization>): Organization {
  return {
    id: 1,
    code: "CI",
    name: "College of Informatics",
    short_name: "CoI",
    organization_type: "COLLEGE",
    parent: 1,
    description: "",
    status: "ACTIVE",
    metadata: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

function renderForm(props: Partial<React.ComponentProps<typeof OrganizationForm>> = {}) {
  return render(
    <ToastProvider>
      <OrganizationForm organization={null} etag={null} {...props} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getOrganizationTree.mockResolvedValue({ ok: true, data: { count: 0, results: [] } });
});

/**
 * Pick an option in the shared `SelectFilter` — a non-native MUI Select is
 * a combobox, not an `<input>`, so it is driven by opening the listbox with
 * a mouseDown and clicking the option that appears.
 */
async function pickOption(name: RegExp, option: string) {
  fireEvent.mouseDown(screen.getByRole("combobox", { name }));
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

describe("OrganizationForm — create", () => {
  it("renders labelled controls for the approved DTO fields", () => {
    renderForm();
    expect(screen.getByLabelText(/Code/)).toBeTruthy();
    expect(screen.getByLabelText(/Name/)).toBeTruthy();
    expect(screen.getByLabelText(/Organization type/)).toBeTruthy();
    expect(screen.getByLabelText(/Parent unit/)).toBeTruthy();
    expect(screen.getByLabelText(/Short name/)).toBeTruthy();
    expect(screen.getByLabelText(/Description/)).toBeTruthy();
    expect(screen.getByLabelText(/Metadata/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Create organization/i }),
    ).toBeTruthy();
  });

  it("gives usable client feedback and does not call the API when invalid", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /Create organization/i }));

    // The form opts out of native validation, so the accessible error
    // summary — not a browser bubble — is what announces the problems.
    const summary = await screen.findByRole("alert", { name: /check the form/i });
    expect(summary.textContent).toMatch(/code/i);
    expect(summary.textContent).toMatch(/name/i);
    expect(createOrganization).not.toHaveBeenCalled();
  });

  it("submits an approved payload on success and refreshes the view", async () => {
    createOrganization.mockResolvedValue({
      ok: true,
      etag: '"abc"',
      data: { data: org({ id: 9, code: "NEW_ONE" }), etag: '"abc"', requestId: "r" },
    });

    renderForm();
    fireEvent.change(screen.getByLabelText(/Code/i), { target: { value: "new_one" } });
    fireEvent.change(screen.getByLabelText(/^Name/i), {
      target: { value: "New College" },
    });
    await pickOption(/Organization type/i, "College");
    fireEvent.change(screen.getByLabelText(/Metadata/), {
      target: { value: '{"established": 2000}' },
    });

    fireEvent.click(screen.getByRole("button", { name: /Create organization/i }));

    await waitFor(() => expect(createOrganization).toHaveBeenCalledTimes(1));
    const payload = createOrganization.mock.calls[0][0] as Record<string, unknown>;
    // Approved DTO fields only: code normalized, metadata parsed to an object,
    // and no read-only fields (status/id/timestamps) ever sent.
    expect(payload.code).toBe("NEW_ONE");
    expect(payload.organization_type).toBe("COLLEGE");
    expect(payload.metadata).toEqual({ established: 2000 });
    expect(payload.parent).toBeNull();
    expect(payload).not.toHaveProperty("status");
    expect(payload).not.toHaveProperty("id");

    await waitFor(() => expect(push).toHaveBeenCalledWith("/organizations"));
    expect(refresh).toHaveBeenCalled();
  });

  it("shows a 409 duplicate code as a field error rather than a generic failure", async () => {
    createOrganization.mockResolvedValue({
      ok: false,
      error: {
        status: 409,
        code: "conflict",
        message: "The request conflicts with the current resource state.",
        details: { code: ["An organization with this code already exists."] },
        requestId: "req-1",
      },
    });

    renderForm();
    fireEvent.change(screen.getByLabelText(/Code/i), { target: { value: "CI" } });
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: "Dup" } });
    await pickOption(/Organization type/i, "College");
    fireEvent.click(screen.getByRole("button", { name: /Create organization/i }));

    const summary = await screen.findByRole("alert");
    await waitFor(() =>
      expect(summary.textContent).toMatch(/already exists/i),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("surfaces denied writes (403) as an explicit environment message", async () => {
    createOrganization.mockResolvedValue({
      ok: false,
      error: {
        status: 403,
        code: "permission_denied",
        message: "Organization writes require development mode and explicit opt-in.",
        details: null,
        requestId: "req-403",
      },
    });

    renderForm();
    fireEvent.change(screen.getByLabelText(/Code/i), { target: { value: "X1" } });
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: "N" } });
    await pickOption(/Organization type/i, "College");
    fireEvent.click(screen.getByRole("button", { name: /Create organization/i }));

    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      expect(
        alerts.some((alert) => /not enabled in this environment/i.test(alert.textContent ?? "")),
      ).toBe(true);
    });
    expect(push).not.toHaveBeenCalled();
  });

  it("shows invalid JSON metadata before any request is made", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/Code/i), { target: { value: "X1" } });
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: "N" } });
    await pickOption(/Organization type/i, "College");
    fireEvent.change(screen.getByLabelText(/Metadata/), { target: { value: "{ nope" } });

    fireEvent.click(screen.getByRole("button", { name: /Create organization/i }));

    await waitFor(() => expect(createOrganization).not.toHaveBeenCalled());
    expect(screen.getByRole("alert").textContent).toMatch(/valid JSON/i);
  });
});

describe("OrganizationForm — edit", () => {
  it("locks the immutable code and sends a conditional update with the ETag", async () => {
    updateOrganization.mockResolvedValue({
      ok: true,
      etag: '"def"',
      data: { data: org({ name: "Renamed" }), etag: '"def"', requestId: "r" },
    });

    renderForm({ organization: org({}), etag: '"abc"' });

    const code = screen.getByLabelText(/Code/i) as HTMLInputElement;
    expect(code.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => expect(updateOrganization).toHaveBeenCalledTimes(1));
    expect(updateOrganization).toHaveBeenCalledWith(1, '"abc"', {
      name: "Renamed",
      short_name: "CoI",
      organization_type: "COLLEGE",
      parent: 1,
      description: "",
      metadata: {},
    });
    // The immutable code is never part of an update payload.
    const third = updateOrganization.mock.calls[0][2] as Record<string, unknown>;
    expect(third).not.toHaveProperty("code");
    expect(third).not.toHaveProperty("status");

    await waitFor(() => expect(push).toHaveBeenCalledWith("/organizations"));
  });

  it("reports a stale ETag (412) as a concurrency conflict asking for a reload", async () => {
    updateOrganization.mockResolvedValue({
      ok: false,
      error: {
        status: 412,
        code: "precondition_failed",
        message: "The organization changed. Retrieve it and reconcile your changes.",
        details: null,
        requestId: "req-412",
      },
    });

    renderForm({ organization: org({}), etag: '"stale"' });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      expect(
        alerts.some((alert) => /changed since you opened it/i.test(alert.textContent ?? "")),
      ).toBe(true);
    });
    expect(push).not.toHaveBeenCalled();
  });

  it("reports a missing precondition (428) distinctly", async () => {
    updateOrganization.mockResolvedValue({
      ok: false,
      error: {
        status: 428,
        code: "precondition_required",
        message: "Supply the current detail response ETag in If-Match.",
        details: null,
        requestId: "req-428",
      },
    });

    renderForm({ organization: org({}), etag: null });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      expect(
        alerts.some((alert) => /missing its concurrency token/i.test(alert.textContent ?? "")),
      ).toBe(true);
    });
  });

  it("locks hierarchy fields on the institutional root", () => {
    renderForm({
      organization: org({ parent: null, organization_type: "UNIVERSITY" }),
      etag: '"x"',
    });

    // The root cannot be moved or retyped, so both selects are disabled and
    // the reason is stated. The shared SelectFilter renders a combobox, so
    // the lock is announced via `aria-disabled`.
    const typeSelect = screen.getByLabelText(/Organization type/i);
    const parentSelect = screen.getByLabelText(/Parent unit/i);
    expect(typeSelect.getAttribute("aria-disabled")).toBe("true");
    expect(parentSelect.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getAllByText(/cannot be moved or retyped/i).length).toBeGreaterThan(0);
  });

  it("locks hierarchy fields on an archived unit", () => {
    renderForm({
      organization: org({ status: "ARCHIVED", parent: 1 }),
      etag: '"x"',
    });
    const parentSelect = screen.getByLabelText(/Parent unit/i);
    expect(parentSelect.getAttribute("aria-disabled")).toBe("true");
  });
});
