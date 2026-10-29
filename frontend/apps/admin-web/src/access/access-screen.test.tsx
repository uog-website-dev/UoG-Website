import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AssignmentAuditEvent,
  CallerAccess,
  EffectiveAccess,
  PaginatedResponse,
  PlatformUser,
  UserAssignment,
} from "@uog/types";
import { ToastProvider } from "@uog/ui";

const searchUsers = vi.fn();
const getCallerAccess = vi.fn();
const getEffectiveAccess = vi.fn();
const listAssignments = vi.fn();
const createAssignment = vi.fn();
const revokeAssignment = vi.fn();
const listAssignmentAudit = vi.fn();

vi.mock("@/app/access/actions", () => ({
  searchUsers: (...args: unknown[]) => searchUsers(...args),
  getCallerAccess: (...args: unknown[]) => getCallerAccess(...args),
  getEffectiveAccess: (...args: unknown[]) => getEffectiveAccess(...args),
  listAssignments: (...args: unknown[]) => listAssignments(...args),
  createAssignment: (...args: unknown[]) => createAssignment(...args),
  revokeAssignment: (...args: unknown[]) => revokeAssignment(...args),
  listAssignmentAudit: (...args: unknown[]) => listAssignmentAudit(...args),
}));

import { AccessScreen } from "./access-screen";

const STAMP = "2026-10-24T09:00:00.000000Z";

function user(partial: Partial<PlatformUser> = {}): PlatformUser {
  return {
    id: "sub-0001-devuser",
    username: "devuser",
    email: "devuser@uog.et",
    first_name: "Development",
    last_name: "User",
    enabled: true,
    ...partial,
  };
}

function assignment(partial: Partial<UserAssignment> = {}): UserAssignment {
  return {
    id: 101,
    user_id: "sub-0001-devuser",
    username: "devuser",
    role: "platform-admin",
    scope_type: "PLATFORM",
    scope_id: null,
    scope_label: "Whole platform",
    created_at: STAMP,
    created_by: "uog_admin",
    ...partial,
  };
}

function page<T>(results: T[], count = results.length): PaginatedResponse<T> {
  return { count, next: null, previous: null, results };
}

function ok(data: unknown) {
  return { ok: true as const, data };
}

function failure(message: string, status = 500, details: unknown = null) {
  return {
    ok: false as const,
    error: { status, code: "api_error", message, details, requestId: "req-1" },
  };
}

/** A platform administrator who manages the platform scope and Site 1. */
function adminAccess(): CallerAccess {
  return {
    username: "devuser",
    roles: ["platform-admin"],
    assignable_roles: ["platform-viewer", "platform-editor", "platform-admin"],
    manageable_scopes: [
      { type: "PLATFORM", id: null, label: "Whole platform" },
      { type: "SITE", id: 1, label: "University of Gondar (UOG_MAIN)" },
    ],
  };
}

const EFFECTIVE: EffectiveAccess = {
  user_id: "sub-0001-devuser",
  username: "devuser",
  permissions: [
    {
      role: "platform-admin",
      scope_type: "PLATFORM",
      scope_id: null,
      scope_label: "Whole platform",
      permissions: ["console.read", "access.manage"],
    },
  ],
};

const AUDIT: AssignmentAuditEvent = {
  id: 9001,
  action: "assignment.created",
  entity_type: "UserAssignment",
  entity_id: "101",
  actor_kind: "USER",
  actor_id: "devuser",
  timestamp: STAMP,
  request_id: "req-1",
};

function renderScreen() {
  return render(
    <ToastProvider>
      <AccessScreen />
    </ToastProvider>,
  );
}

/**
 * Pick an option in the shared `SelectFilter` — a non-native MUI Select is
 * a combobox, driven by opening the listbox with a mouseDown and clicking
 * the option that appears.
 */
async function pickOption(name: RegExp, option: RegExp | string) {
  fireEvent.mouseDown(screen.getByRole("combobox", { name }));
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

beforeEach(() => {
  vi.clearAllMocks();
  getCallerAccess.mockResolvedValue(ok(adminAccess()));
  searchUsers.mockResolvedValue(ok(page([user()])));
  getEffectiveAccess.mockResolvedValue(ok(EFFECTIVE));
  listAssignments.mockResolvedValue(ok(page([assignment()])));
  listAssignmentAudit.mockResolvedValue(ok(page([AUDIT])));
  createAssignment.mockResolvedValue(
    ok({
      data: assignment({ id: 500 }),
      etag: '"assignment-500-v1"',
      requestId: null,
    }),
  );
  revokeAssignment.mockResolvedValue(ok(undefined));
});

describe("AccessScreen — states", () => {
  it("renders the user search, effective summary, assignments and audit trail", async () => {
    renderScreen();

    expect(await screen.findByText("Find a user")).toBeTruthy();
    expect(
      await screen.findByRole("button", { name: "View access for devuser" }),
    ).toBeTruthy();

    // Select the user to load the detail panels.
    fireEvent.click(screen.getByRole("button", { name: "View access for devuser" }));

    expect(
      await screen.findByRole("heading", { name: "Effective permissions" }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Role assignments" })).toBeTruthy();
    expect(await screen.findByText("Recent access changes")).toBeTruthy();
    expect(screen.getByText("Role assigned")).toBeTruthy();
    expect(getEffectiveAccess).toHaveBeenCalledWith("sub-0001-devuser");
  });

  it("shows an honest empty state when the search matches nobody", async () => {
    searchUsers.mockResolvedValue(ok(page([])));
    renderScreen();

    expect(await screen.findByText("No users found")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /View access/ })).toBeNull();
  });

  it("shows the failure with its correlation id", async () => {
    searchUsers.mockResolvedValue(failure("Backend exploded", 500));
    renderScreen();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Backend exploded");
    expect(alert.textContent).toContain("req-1");
  });

  it("renders a permission-denied state when the backend refuses the read (403)", async () => {
    getCallerAccess.mockResolvedValue(failure("Not allowed for your role.", 403));
    renderScreen();

    expect(await screen.findByText("Permission denied")).toBeTruthy();
    expect(screen.getByText(/Not allowed for your role\./)).toBeTruthy();
    // No management UI is offered behind a denial.
    expect(screen.queryByText("Find a user")).toBeNull();
  });

  it("asks the user to sign in again when the session expired (401)", async () => {
    getCallerAccess.mockResolvedValue(failure("Invalid token.", 401));
    renderScreen();

    expect(await screen.findByText("Sign-in required")).toBeTruthy();
  });
});

describe("AccessScreen — role visibility", () => {
  it("offers only the roles and scopes the caller may manage", async () => {
    getCallerAccess.mockResolvedValue(
      ok({
        username: "alemayehu",
        roles: ["platform-editor"],
        assignable_roles: ["platform-viewer", "platform-editor"],
        manageable_scopes: [{ type: "SITE", id: 1, label: "University of Gondar (UOG_MAIN)" }],
      } satisfies CallerAccess),
    );
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "View access for devuser" }));

    fireEvent.click(await screen.findByRole("button", { name: "Assign role" }));
    expect(await screen.findByRole("dialog", { name: "Assign a role" })).toBeTruthy();

    // A site-scoped administrator can never grant the platform administrator role.
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /^Role$/ }));
    const options = await screen.findAllByRole("option");
    const labels = options.map((option) => option.textContent);
    expect(labels).toContain("Platform editor");
    expect(labels).not.toContain("Platform administrator");
    // Choose an option so the menu closes before inspecting the next field.
    fireEvent.click(await screen.findByRole("option", { name: "Platform editor" }));

    // …and the scope picker offers only the Site they manage.
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Scope type" }));
    expect(await screen.findByRole("option", { name: "Site" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Platform-wide" })).toBeNull();
  });

  it("disables assignment for a caller with nothing to grant, and says why", async () => {
    getCallerAccess.mockResolvedValue(
      ok({
        username: "sara",
        roles: ["platform-viewer"],
        assignable_roles: [],
        manageable_scopes: [],
      } satisfies CallerAccess),
    );
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "View access for devuser" }));

    const button = await screen.findByRole("button", { name: "Assign role" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Read-only view/)).toBeTruthy();
  });
});

describe("AccessScreen — create assignment", () => {
  it("submits role and scope, refreshes the views and closes", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "View access for devuser" }));
    fireEvent.click(await screen.findByRole("button", { name: "Assign role" }));
    await screen.findByRole("dialog", { name: "Assign a role" });

    await pickOption(/^Role$/, "Platform viewer");
    // Scope type defaults to Platform-wide for this caller.
    const dialog = screen.getByRole("dialog", { name: "Assign a role" });
    expect(
      within(dialog).getAllByText("Whole platform").length).toBeGreaterThan(0,
    );
    expect(within(dialog).getByText(/will hold/)).toBeTruthy();

    const callsBefore = listAssignments.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Assign role" }));

    expect(await screen.findByText("Role assigned to devuser.")).toBeTruthy();
    expect(createAssignment).toHaveBeenCalledTimes(1);
    expect(createAssignment).toHaveBeenCalledWith({
      user_id: "sub-0001-devuser",
      role: "platform-viewer",
      scope_type: "PLATFORM",
      scope_id: null,
    });
    await waitFor(() =>
      expect(listAssignments.mock.calls.length).toBeGreaterThan(callsBefore),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("prevents duplicate submissions while the request is in flight", async () => {
    let resolveCreate: (value: unknown) => void = () => {};
    createAssignment.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );

    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "View access for devuser" }));
    fireEvent.click(await screen.findByRole("button", { name: "Assign role" }));
    await screen.findByRole("dialog", { name: "Assign a role" });
    await pickOption(/^Role$/, "Platform viewer");

    const submit = screen.getByRole("button", { name: "Assign role" });
    fireEvent.click(submit);
    expect(await screen.findByRole("button", { name: "Assigning…" })).toBeTruthy();

    // A second activation cannot start another request.
    fireEvent.click(submit);
    expect(createAssignment).toHaveBeenCalledTimes(1);

    resolveCreate(
      ok({ data: assignment({ id: 501 }), etag: '"x"', requestId: null }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("keeps the dialog and the entered values when the backend rejects (409)", async () => {
    createAssignment.mockResolvedValue(
      failure("devuser already holds this role.", 409),
    );
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "View access for devuser" }));
    fireEvent.click(await screen.findByRole("button", { name: "Assign role" }));
    await screen.findByRole("dialog", { name: "Assign a role" });
    await pickOption(/^Role$/, "Platform viewer");

    fireEvent.click(screen.getByRole("button", { name: "Assign role" }));

    expect(
      await screen.findByText("devuser already holds this role."),
    ).toBeTruthy();
    // The dialog stays open with the selection preserved.
    expect(screen.getByRole("dialog", { name: "Assign a role" })).toBeTruthy();
    expect(
      within(screen.getByRole("combobox", { name: /^Role$/ })).getByText("Platform viewer"),
    ).toBeTruthy();
    expect(revokeAssignment).not.toHaveBeenCalled();
  });

  it("maps backend field errors onto the offending control", async () => {
    createAssignment.mockResolvedValue(
      failure("Invalid input.", 400, {
        scope_id: ["Select a scope before assigning this role."],
      }),
    );
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "View access for devuser" }));
    fireEvent.click(await screen.findByRole("button", { name: "Assign role" }));
    await screen.findByRole("dialog", { name: "Assign a role" });
    await pickOption(/^Role$/, "Platform viewer");

    fireEvent.click(screen.getByRole("button", { name: "Assign role" }));

    expect(
      await screen.findByText("Select a scope before assigning this role."),
    ).toBeTruthy();
  });

  it("displays a denied write (403) without pretending it succeeded", async () => {
    createAssignment.mockResolvedValue(
      failure("You are not allowed to grant this role.", 403),
    );
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "View access for devuser" }));
    fireEvent.click(await screen.findByRole("button", { name: "Assign role" }));
    await screen.findByRole("dialog", { name: "Assign a role" });
    await pickOption(/^Role$/, "Platform viewer");

    fireEvent.click(screen.getByRole("button", { name: "Assign role" }));

    expect(
      await screen.findByText("You are not allowed to grant this role."),
    ).toBeTruthy();
    expect(screen.queryByText(/Role assigned to/)).toBeNull();
  });

  it("validates the form before calling the API", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "View access for devuser" }));
    fireEvent.click(await screen.findByRole("button", { name: "Assign role" }));
    await screen.findByRole("dialog", { name: "Assign a role" });

    fireEvent.click(screen.getByRole("button", { name: "Assign role" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Select the role/i);
    expect(createAssignment).not.toHaveBeenCalled();
  });
});

describe("AccessScreen — revoke assignment", () => {
  it("confirms before revoking, then refreshes the lists", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "View access for devuser" }));

    fireEvent.click(
      await screen.findByRole("button", { name: /Revoke Platform administrator/ }),
    );
    const confirm = await screen.findByRole("dialog", { name: "Revoke this access?" });
    expect(confirm.textContent).toContain("Whole platform");

    const callsBefore = listAssignments.mock.calls.length;
    fireEvent.click(within(confirm).getByRole("button", { name: "Revoke access" }));

    expect(await screen.findByText("Access revoked for devuser.")).toBeTruthy();
    expect(revokeAssignment).toHaveBeenCalledWith(101);
    await waitFor(() =>
      expect(listAssignments.mock.calls.length).toBeGreaterThan(callsBefore),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows the backend failure inside the confirmation instead of closing it", async () => {
    revokeAssignment.mockResolvedValue(
      failure("This assignment changed since it was read.", 412),
    );
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "View access for devuser" }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Revoke Platform administrator/ }),
    );
    const confirm = await screen.findByRole("dialog", { name: "Revoke this access?" });

    fireEvent.click(within(confirm).getByRole("button", { name: "Revoke access" }));

    const alert = await within(confirm).findByRole("alert");
    expect(alert.textContent).toContain("changed since it was read");
    expect(screen.getByRole("dialog", { name: "Revoke this access?" })).toBeTruthy();
    expect(screen.queryByText(/Access revoked/)).toBeNull();
  });

  it("does not offer revoke for a scope the caller does not manage", async () => {
    listAssignments.mockResolvedValue(
      ok(
        page([
          assignment(),
          assignment({
            id: 202,
            role: "platform-editor",
            scope_type: "ORGANIZATION",
            scope_id: 9,
            scope_label: "College of Informatics (CI)",
          }),
        ]),
      ),
    );
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "View access for devuser" }));

    expect(
      await screen.findByRole("button", { name: /Revoke Platform administrator/ }),
    ).toBeTruthy();
    expect(await screen.findByText("Not in your scope")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Revoke Platform editor/ }),
    ).toBeNull();
  });
});
