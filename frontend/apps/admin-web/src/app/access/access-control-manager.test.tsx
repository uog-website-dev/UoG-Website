import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AccessControlData, AccessScopeSelection, RoleDefinition } from "./actions";

const getAccessControlData = vi.fn();
const assignRole = vi.fn();
const revokeRoleAssignment = vi.fn();
const getUserEffectivePermissions = vi.fn();

vi.mock("@/app/access/actions", () => ({
  getAccessControlData: (...args: unknown[]) => getAccessControlData(...args),
  assignRole: (...args: unknown[]) => assignRole(...args),
  revokeRoleAssignment: (...args: unknown[]) => revokeRoleAssignment(...args),
  getUserEffectivePermissions: (...args: unknown[]) => getUserEffectivePermissions(...args),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  replaceRolePermissions: vi.fn(),
}));

import { AccessControlManager } from "./access-control-manager";

const EDITOR: RoleDefinition = {
  id: 4,
  code: "editor",
  name: "Editor",
  description: "Create and edit content.",
  is_system: true,
  is_active: true,
  permissions: ["content.pages.create", "content.pages.update", "menu.write"],
};

const REVIEWER: RoleDefinition = {
  ...EDITOR,
  id: 5,
  code: "reviewer",
  name: "Reviewer",
  permissions: ["content.pages.view", "menu.read"],
};

const VIEWER: RoleDefinition = {
  ...EDITOR,
  id: 7,
  code: "viewer",
  name: "Viewer",
  permissions: ["content.pages.view", "platform.users.view"],
};

function sectionError(message: string, requestId: string) {
  return {
    status: "error" as const,
    error: { status: 500, code: "api_error", message, details: null, requestId },
  };
}

function loaded(overrides: Partial<AccessControlData> = {}): AccessControlData {
  return {
    permissions: { status: "ready", data: [] },
    roles: { status: "ready", data: [EDITOR, REVIEWER, VIEWER] },
    assignments: { status: "ready", data: [] },
    effective: {
      status: "ready",
      data: ["platform.users.view", "platform.users.assign_roles"],
    },
    callerUserId: 3,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getAccessControlData.mockResolvedValue(loaded());
  assignRole.mockResolvedValue({ ok: true, data: { id: 40 } });
  revokeRoleAssignment.mockResolvedValue({ ok: true, data: { id: 40, revoked_at: "2026-11-03T00:00:00Z" } });
  getUserEffectivePermissions.mockResolvedValue({
    ok: true,
    data: { user: 20, organization: 5, site: 2, permissions: ["content.pages.create", "menu.write"] },
  });
});

async function pickOption(combobox: HTMLElement, option: string) {
  fireEvent.mouseDown(combobox);
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

describe("Access control manager", () => {
  it("does not present the initial load as an empty grant list", () => {
    getAccessControlData.mockReturnValue(new Promise(() => undefined));
    render(<AccessControlManager />);

    expect(screen.getAllByText("Loading registered access data…").length).toBeGreaterThan(0);
    expect(screen.queryByText("No roles are visible to this account.")).toBeNull();
    expect(screen.queryByText("No effective permissions are granted for this scope.")).toBeNull();
    expect(screen.queryByText("No assignments are visible in the selected scope.")).toBeNull();
  });

  it("shows a backend failure and its correlation id instead of an empty catalog", async () => {
    getAccessControlData.mockResolvedValue({
      permissions: sectionError("The permission catalog could not be read.", "req-permissions"),
      roles: sectionError("The role catalog could not be read.", "req-roles"),
      assignments: sectionError("Role assignments could not be read.", "req-assignments"),
      effective: sectionError("Sign in is required.", "req-session"),
      callerUserId: null,
    });
    render(<AccessControlManager />);

    expect((await screen.findAllByText("The role catalog could not be read. Reference req-roles.")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Role assignments could not be read. Reference req-assignments.").length).toBeGreaterThan(0);
    expect(screen.getByText("Sign in is required. Reference req-session.")).toBeTruthy();
    expect(screen.queryByText("No roles are visible to this account.")).toBeNull();
    expect(screen.queryByText("No effective permissions are granted for this scope.")).toBeNull();
  });

  it("shows an empty state only after a successful empty response", async () => {
    getAccessControlData.mockResolvedValue(loaded({
      roles: { status: "ready", data: [] },
      effective: { status: "ready", data: [] },
    }));
    render(<AccessControlManager />);

    expect(await screen.findByText("No roles are visible to this account.")).toBeTruthy();
    expect(screen.getByText("No effective permissions are granted for this scope.")).toBeTruthy();
    expect(screen.getByText("No assignments are visible in the selected scope.")).toBeTruthy();
  });

  it("renders Editor, Reviewer and Viewer from the registered permission arrays", async () => {
    render(<AccessControlManager />);

    const matrix = await screen.findByRole("table", { name: "Editor reviewer and viewer permissions" });
    expect(within(matrix).getByText("content.pages.create, content.pages.update, menu.write")).toBeTruthy();
    expect(within(matrix).getByText("content.pages.view, menu.read")).toBeTruthy();
    expect(within(matrix).getByText("content.pages.view, platform.users.view")).toBeTruthy();
  });

  it("assigns a site role and shows the refreshed effective permissions", async () => {
    const assigned = loaded({
      assignments: {
        status: "ready",
        data: [{
          id: 40,
          user: 20,
          user_name: "site-editor",
          role: 4,
          role_name: "Editor",
          scope: "SITE",
          organization: 5,
          site: 2,
          assigned_at: "2026-11-03T00:00:00Z",
          expires_at: null,
          revoked_at: null,
        }],
      },
    });
    getAccessControlData.mockImplementation(async (scope?: AccessScopeSelection) => (
      scope?.scope === "SITE" ? assigned : loaded()
    ));
    render(<AccessControlManager />);

    fireEvent.change(await screen.findByLabelText(/User ID/), { target: { value: "20" } });
    await pickOption(screen.getByRole("combobox", { name: "Role" }), "Editor (editor)");
    fireEvent.change(screen.getByLabelText(/Organization ID/), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/Site ID/), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign role" }));

    await waitFor(() => expect(assignRole).toHaveBeenCalledWith({
      user: 20,
      role: 4,
      scope: "SITE",
      organization: 5,
      site: 2,
    }));
    expect(await screen.findByText("Role assigned.")).toBeTruthy();
    expect(getUserEffectivePermissions).toHaveBeenCalledWith(20, { scope: "SITE", organization: 5, site: 2 });
    const inspected = await screen.findByLabelText("Inspected effective permissions");
    expect(within(inspected).getByText("content.pages.create")).toBeTruthy();
    expect(within(inspected).getByText("menu.write")).toBeTruthy();
    expect(screen.getByText("site-editor")).toBeTruthy();
  });

  it("shows self-escalation and foreign delegation failures without treating them as success", async () => {
    render(<AccessControlManager />);
    fireEvent.change(await screen.findByLabelText(/User ID/), { target: { value: "3" } });
    await pickOption(screen.getByRole("combobox", { name: "Role" }), "Editor (editor)");
    fireEvent.change(screen.getByLabelText(/Organization ID/), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/Site ID/), { target: { value: "9" } });

    assignRole.mockResolvedValueOnce({
      ok: false,
      error: {
        status: 403,
        code: "permission_denied",
        message: "You do not have permission to perform this action.",
        details: { detail: "You cannot assign a role to yourself." },
        requestId: "req-self",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Assign role" }));
    const selfAlert = (await screen.findByRole("alert")).textContent ?? "";
    expect(selfAlert).toContain("You do not have permission to perform this action.");
    expect(selfAlert).toContain("You cannot assign a role to yourself.");
    expect(selfAlert).toContain("Reference req-self.");
    expect(getUserEffectivePermissions).not.toHaveBeenCalled();

    assignRole.mockResolvedValueOnce({
      ok: false,
      error: {
        status: 403,
        code: "permission_denied",
        message: "You do not have permission to perform this action.",
        details: { detail: "The requested assignment is outside your delegation scope." },
        requestId: "req-foreign",
      },
    });
    fireEvent.change(screen.getByLabelText(/User ID/), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign role" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "The requested assignment is outside your delegation scope. Reference req-foreign.",
    );
    expect(screen.queryByText("Role assigned.")).toBeNull();
  });

  it("revokes a site assignment and refreshes that user's effective permissions", async () => {
    const assignment = {
      id: 40,
      user: 20,
      user_name: "site-editor",
      role: 4,
      role_name: "Editor",
      scope: "SITE" as const,
      organization: 5,
      site: 2,
      assigned_at: "2026-11-03T00:00:00Z",
      expires_at: null,
      revoked_at: null,
    };
    getAccessControlData.mockImplementation(async (scope?: AccessScopeSelection) => (
      scope?.scope === "SITE"
        ? loaded({ assignments: { status: "ready", data: [assignment] } })
        : loaded()
    ));
    getUserEffectivePermissions.mockResolvedValue({
      ok: true,
      data: { user: 20, organization: 5, site: 2, permissions: [] },
    });
    render(<AccessControlManager />);

    const scopes = await screen.findAllByRole("combobox", { name: "Scope" });
    await pickOption(scopes[0], "Site");
    fireEvent.change(screen.getAllByLabelText(/Site ID/)[0], { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Show this scope" }));

    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(revokeRoleAssignment).toHaveBeenCalledWith(40));
    expect(await screen.findByText("Role assignment revoked.")).toBeTruthy();
    expect(getUserEffectivePermissions).toHaveBeenCalledWith(20, { scope: "SITE", site: 2, organization: 5 });
    expect(await screen.findByText("No effective permissions are granted to this user for the selected scope.")).toBeTruthy();
  });
});
