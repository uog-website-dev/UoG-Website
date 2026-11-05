import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listModuleOperations = vi.fn();
const getModuleOperation = vi.fn();

vi.mock("@/app/modules/actions", () => ({
  listModuleOperations: (...args: unknown[]) => listModuleOperations(...args),
  getModuleOperation: (...args: unknown[]) => getModuleOperation(...args),
}));

import { OperationHistory } from "./operation-history";

const OPERATION = {
  id: "0f6d1f4e-7c1b-4d7a-9a55-3e6d2f1a9b10", action: "DISABLE", module_codes: ["POSTS"], scope_type: "SELECTED",
  scope: { type: "SELECTED", site_ids: [2, 3] }, reason: "Content review", actor: { id: "1", username: "devuser" },
  request_id: "a1b2c3d4-0000-4000-8000-000000000001", matched_count: 2, changed_site_count: 2, unchanged_count: 0,
  blocked_count: 0, change_count: 2, created_at: "2026-11-04T10:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  listModuleOperations.mockResolvedValue({ ok: true, data: { count: 1, next: null, previous: null, results: [OPERATION] } });
  getModuleOperation.mockResolvedValue({
    ok: true,
    data: { ...OPERATION, changes: [{ site: 2, site_code: "INF", site_name: "Informatics", module: "POSTS", previous_state: "ENABLED", new_state: "DISABLED" }] },
  });
});

describe("OperationHistory", () => {
  it("lists operations and shows every change with its audit fields", async () => {
    render(<OperationHistory modules={[]} refreshKey={0} />);
    const row = (await screen.findByText("Content review")).closest("tr");
    expect(row?.textContent).toContain("devuser");
    expect(row?.textContent).toContain("Disable");
    expect(row?.textContent).toContain("2 on 2 Sites");

    fireEvent.click(screen.getByRole("button", { name: /Details for operation/ }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.textContent).toContain("Informatics"));
    expect(getModuleOperation).toHaveBeenCalledWith(OPERATION.id);
    expect(dialog.textContent).toContain("Enabled");
    expect(dialog.textContent).toContain("Disabled");
    expect(dialog.textContent).toContain(OPERATION.request_id);
  });

  it("filters by action and reloads after a new operation", async () => {
    const { rerender } = render(<OperationHistory modules={[]} refreshKey={0} />);
    await screen.findByText("Content review");
    fireEvent.mouseDown(screen.getByLabelText("Action"));
    fireEvent.click(await screen.findByRole("option", { name: "Enable" }));
    fireEvent.submit(screen.getByRole("search"));
    await waitFor(() => expect(listModuleOperations).toHaveBeenLastCalledWith({ action: "ENABLE", page: 1 }));
    rerender(<OperationHistory modules={[]} refreshKey={1} />);
    await waitFor(() => expect(listModuleOperations).toHaveBeenCalledTimes(3));
  });

  it("explains an empty history", async () => {
    listModuleOperations.mockResolvedValue({ ok: true, data: { count: 0, next: null, previous: null, results: [] } });
    render(<OperationHistory modules={[]} refreshKey={0} />);
    expect(await screen.findByText("No operations yet")).toBeTruthy();
  });
});
