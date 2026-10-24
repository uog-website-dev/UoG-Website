import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Organization, OrganizationHierarchy as OrganizationHierarchyData } from "@uog/types";
import type { ActionResult } from "@/organizations/contract";

const { getOrganizationTree, moveOrganization } = vi.hoisted(() => ({
  getOrganizationTree: vi.fn(),
  moveOrganization: vi.fn(),
}));

vi.mock("@/app/organizations/actions", () => ({
  getOrganizationTree,
  moveOrganization,
}));

import { OrganizationHierarchy } from "./organization-hierarchy";

const units: Organization[] = [
  {
    id: 1,
    code: "UOG",
    name: "University of Gondar",
    short_name: "UoG",
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
    code: "COLLEGE",
    name: "College",
    short_name: "",
    organization_type: "COLLEGE",
    parent: 1,
    description: "",
    status: "ACTIVE",
    metadata: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: 3,
    code: "DEPARTMENT",
    name: "Department",
    short_name: "",
    organization_type: "DEPARTMENT",
    parent: 2,
    description: "",
    status: "ACTIVE",
    metadata: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: 4,
    code: "OTHER_COLLEGE",
    name: "Other college",
    short_name: "",
    organization_type: "COLLEGE",
    parent: 1,
    description: "",
    status: "ACTIVE",
    metadata: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: 5,
    code: "ARCHIVED_UNIT",
    name: "Archived unit",
    short_name: "",
    organization_type: "COLLEGE",
    parent: 1,
    description: "",
    status: "ARCHIVED",
    metadata: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

const hierarchy: OrganizationHierarchyData = { count: units.length, results: units };

function renderHierarchy() {
  return render(<OrganizationHierarchy initialTree={hierarchy} />);
}

describe("organization hierarchy browser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrganizationTree.mockResolvedValue({ ok: true, data: hierarchy });
  });

  it("renders a nested accessible tree, supports keyboard expansion and ancestor navigation", async () => {
    renderHierarchy();

    expect(screen.queryByText("Institutional structure")).toBeNull();
    expect(screen.getByRole("button", { name: "Refresh organization hierarchy" })).toBeTruthy();

    const tree = screen.getByRole("tree", { name: "Organization hierarchy" });
    const root = within(tree).getByRole("treeitem", { name: /University of Gondar/ });
    expect(root.getAttribute("aria-level")).toBe("1");
    expect(root.getAttribute("aria-expanded")).toBe("true");

    root.focus();
    fireEvent.keyDown(root, { key: "ArrowDown" });
    const nextUnit = within(tree).getByRole("treeitem", { name: /Archived unit/ });
    await waitFor(() => expect(document.activeElement).toBe(nextUnit));
    expect(nextUnit.getAttribute("aria-level")).toBe("2");

    const college = within(tree).getByRole("treeitem", { name: /^College/ });
    fireEvent.keyDown(college, { key: "ArrowRight" });
    await waitFor(() => {
      expect(within(tree).getByRole("treeitem", { name: /Department/ })).toBeTruthy();
    });
    const department = within(tree).getByRole("treeitem", { name: /Department/ });
    expect(department.getAttribute("aria-level")).toBe("3");
    fireEvent.click(department);

    const ancestors = screen.getByRole("navigation", { name: "Organization ancestors" });
    const goToCollege = within(ancestors).getByRole("button", {
      name: "Go to ancestor College",
    });
    fireEvent.click(goToCollege);
    expect(screen.getByText("College", { selector: "h6" })).toBeTruthy();
  });

  it("refreshes from the structure section", async () => {
    renderHierarchy();

    fireEvent.click(screen.getByRole("button", { name: "Refresh organization hierarchy" }));

    await waitFor(() => expect(getOrganizationTree).toHaveBeenCalledTimes(1));
  });

  it("hides the selected and archived parent options and lets the backend reject cycle candidates", async () => {
    renderHierarchy();

    expect(
      (screen.getByRole("button", { name: "Move organization" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    const college = screen.getByRole("treeitem", { name: /^College/ });
    fireEvent.keyDown(college, { key: "ArrowRight" });
    fireEvent.click(college);
    fireEvent.click(screen.getByRole("button", { name: "Move organization" }));

    const parentSelect = screen.getByRole("combobox", { name: "New parent" });
    fireEvent.mouseDown(parentSelect);
    const departmentOption = await screen.findByRole("option", {
      name: /^—.*DEPARTMENT · Department$/,
    });
    expect(screen.queryByRole("option", { name: /COLLEGE · College/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /ARCHIVED_UNIT/ })).toBeNull();
    fireEvent.click(departmentOption);

    moveOrganization.mockResolvedValue({
      ok: false,
      error: {
        status: 400,
        code: "validation_error",
        message: "The request contains invalid fields.",
        details: {
          parent: ["An organization unit cannot be moved under its descendant."],
        },
        requestId: "move-cycle",
      },
    } satisfies ActionResult<unknown>);
    fireEvent.click(screen.getByRole("button", { name: "Confirm move" }));

    expect(
      await screen.findByText("An organization unit cannot be moved under its descendant."),
    ).toBeTruthy();
    expect(moveOrganization).toHaveBeenCalledWith(2, 3);
  });

  it.each([
    {
      status: 412,
      code: "precondition_failed",
      message: "The organization changed; reload it before retrying.",
      requestId: "move-stale",
    },
    {
      status: 403,
      code: "permission_denied",
      message: "You do not have permission to move this organization.",
      requestId: "move-forbidden",
    },
  ])("surfaces backend status $status without applying a rejected move", async (failure) => {
    moveOrganization.mockResolvedValue({
      ok: false,
      error: {
        ...failure,
        details: null,
      },
    });
    renderHierarchy();

    fireEvent.click(screen.getByRole("treeitem", { name: /Other college/ }));
    fireEvent.click(screen.getByRole("button", { name: "Move organization" }));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "New parent" }));
    fireEvent.click(await screen.findByRole("option", { name: /^— COLLEGE · College$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm move" }));

    expect(await screen.findByText(failure.message)).toBeTruthy();
    expect(screen.getByText(`Reference: ${failure.requestId}`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(
      screen.getByRole("treeitem", { name: /Other college/ }).getAttribute("aria-level"),
    ).toBe("2");
  });

  it("updates the tree after a successful move and shows the API confirmation", async () => {
    const moved = { ...units[3], parent: 2 };
    moveOrganization.mockResolvedValue({
      ok: true,
      data: { data: moved, etag: '"new-etag"', requestId: "move-ok" },
    });
    getOrganizationTree.mockResolvedValue({
      ok: true,
      data: { count: units.length, results: [...units.slice(0, 3), moved] },
    });
    renderHierarchy();

    fireEvent.click(screen.getByRole("treeitem", { name: /Other college/ }));
    fireEvent.click(screen.getByRole("button", { name: "Move organization" }));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "New parent" }));
    fireEvent.click(await screen.findByRole("option", { name: /^— COLLEGE/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm move" }));

    expect((await screen.findByRole("status")).textContent).toContain(
      "Other college was moved successfully.",
    );
    expect(moveOrganization).toHaveBeenCalledWith(4, 2);
    await waitFor(() => {
      const movedRow = screen.getByRole("treeitem", { name: /Other college/ });
      expect(movedRow.getAttribute("aria-level")).toBe("3");
    });
  });
});
