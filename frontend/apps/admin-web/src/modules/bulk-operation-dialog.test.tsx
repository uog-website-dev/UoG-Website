import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApplyResult, OperationPreview } from "./bulk-contract";

const previewModuleOperation = vi.fn();
const applyModuleOperation = vi.fn();

vi.mock("@/app/modules/actions", () => ({
  previewModuleOperation: (...args: unknown[]) => previewModuleOperation(...args),
  applyModuleOperation: (...args: unknown[]) => applyModuleOperation(...args),
}));

import { BulkOperationDialog, describeApplyError } from "./bulk-operation-dialog";

function preview(partial: Partial<OperationPreview> = {}): OperationPreview {
  return {
    action: "ENABLE",
    modules: [{ code: "POSTS", name: "Posts", implementation_status: "AVAILABLE" }],
    scope: { type: "SELECTED", site_ids: [2, 3, 4] },
    summary: {
      matched_sites: 3, eligible_sites: 2, already_in_state_sites: 0, blocked_sites: 1,
      expected_changes: 2, unchanged_pairs: 0, blocked_pairs: 1,
      blocked_reasons: [{ code: "site_archived", count: 1, message: "Archived Sites are frozen." }],
    },
    dependency_warnings: [{ module: "POSTS", message: "POSTS requires PAGES on each Site." }],
    high_impact: false,
    confirmation_phrase: "ENABLE",
    sites: [
      { id: 2, code: "INF", name: "Informatics", status: "ACTIVE", organization: { id: 6, name: "CI" }, outcome: "CHANGE",
        modules: [{ code: "POSTS", previous_state: "NOT_ASSIGNED", new_state: "ENABLED", outcome: "CHANGE", reasons: [] }] },
      { id: 4, code: "OLD", name: "Old Site", status: "ARCHIVED", organization: { id: 6, name: "CI" }, outcome: "BLOCKED",
        modules: [{ code: "POSTS", previous_state: "NOT_ASSIGNED", new_state: "NOT_ASSIGNED", outcome: "BLOCKED",
          reasons: [{ code: "site_archived", message: "Archived Sites are frozen." }] }] },
    ],
    preview_token: "signed-token",
    expires_in: 900,
    ...partial,
  };
}

const applied: ApplyResult = {
  replayed: false,
  operation: {
    id: "op-1", action: "ENABLE", module_codes: ["POSTS"], scope_type: "SELECTED", scope: { type: "SELECTED", site_ids: [2, 3, 4] },
    reason: "", actor: { id: "1", username: "devuser" }, request_id: null, matched_count: 3, changed_site_count: 2,
    unchanged_count: 0, blocked_count: 1, change_count: 2, created_at: "2026-11-04T10:00:00Z", changes: [],
  },
};

function failure(status: number, details: unknown = null) {
  return { ok: false as const, error: { status, code: "x", message: "Failed.", details, requestId: "req-9" } };
}

function renderDialog(overrides: Partial<Parameters<typeof BulkOperationDialog>[0]> = {}) {
  const props = {
    action: "ENABLE" as const,
    modules: ["POSTS"],
    scope: { type: "SELECTED" as const, site_ids: [2, 3, 4] },
    scopeLabel: "3 selected Sites",
    onClose: vi.fn(),
    onApplied: vi.fn(),
    onShowHistory: vi.fn(),
    ...overrides,
  };
  render(<BulkOperationDialog {...props} />);
  return props;
}

beforeEach(() => {
  vi.clearAllMocks();
  previewModuleOperation.mockResolvedValue({ ok: true, data: preview() });
});

describe("BulkOperationDialog", () => {
  it("shows the backend preview and reports success only after the commit", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    applyModuleOperation.mockReturnValue(new Promise((done) => { resolve = done; }));
    const props = renderDialog();

    expect(screen.getByText(/Checking eligibility/)).toBeTruthy();
    expect(await screen.findByText("Matching Sites")).toBeTruthy();
    expect(previewModuleOperation).toHaveBeenCalledWith({ action: "ENABLE", modules: ["POSTS"], scope: props.scope });
    expect(screen.getByText(/Archived Sites are frozen. \(1\)/)).toBeTruthy();
    expect(screen.getByText("POSTS requires PAGES on each Site.")).toBeTruthy();
    expect(screen.getByText(/Not assigned → Enabled/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Faculty news" } });
    fireEvent.click(screen.getByRole("button", { name: "Enable on 2 Sites" }));
    expect(await screen.findByRole("button", { name: /Applying/ })).toBeTruthy();
    expect(screen.queryByText(/was committed/)).toBeNull();
    expect(props.onApplied).not.toHaveBeenCalled();

    const sent = applyModuleOperation.mock.calls[0][0];
    expect(sent).toMatchObject({ previewToken: "signed-token", reason: "Faculty news", confirmation: "" });
    expect(sent.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);

    resolve({ ok: true, data: applied });
    expect(await screen.findByText("The operation was committed.")).toBeTruthy();
    expect(props.onApplied).toHaveBeenCalledWith(applied);
    fireEvent.click(screen.getByRole("button", { name: "View history" }));
    expect(props.onShowHistory).toHaveBeenCalled();
  });

  it("requires a reason and the typed phrase for a high-impact operation", async () => {
    previewModuleOperation.mockResolvedValue({ ok: true, data: preview({ high_impact: true, action: "DISABLE", confirmation_phrase: "DISABLE" }) });
    renderDialog({ action: "DISABLE" });
    const confirm = await screen.findByRole("button", { name: "Disable on 2 Sites" });
    expect(confirm).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText(/Reason \(required\)/), { target: { value: "Review" } });
    expect(confirm).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Type DISABLE"), { target: { value: "disable" } });
    expect(confirm).toHaveProperty("disabled", false);
    expect(screen.getByText(/Content stays/)).toBeTruthy();
  });

  it("rejects a stale preview and offers a refreshed one", async () => {
    applyModuleOperation.mockResolvedValue(failure(409, { reason: "stale_preview", message: "Sites or modules changed after the preview." }));
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Enable on 2 Sites" }));
    expect(await screen.findByText("The preview is out of date")).toBeTruthy();
    expect(screen.getByText(/Nothing was changed/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enable on 2 Sites" })).toHaveProperty("disabled", true);

    previewModuleOperation.mockResolvedValue({ ok: true, data: preview({ preview_token: "fresh-token" }) });
    fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }));
    await waitFor(() => expect(previewModuleOperation).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Enable on 2 Sites" })).toHaveProperty("disabled", false));
    expect(screen.queryByText("The preview is out of date")).toBeNull();
  });

  it("retries an unconfirmed result with the same idempotency key", async () => {
    applyModuleOperation.mockResolvedValueOnce(failure(0)).mockResolvedValueOnce({ ok: true, data: { ...applied, replayed: true } });
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Enable on 2 Sites" }));
    expect(await screen.findByText("The result is not confirmed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("This operation was already committed.")).toBeTruthy();
    const [first, second] = applyModuleOperation.mock.calls.map((call) => call[0].idempotencyKey);
    expect(second).toBe(first);
  });

  it("explains a permission denial and does not offer a retry", async () => {
    applyModuleOperation.mockResolvedValue(failure(403, { detail: "Administration writes require development mode and explicit opt-in." }));
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Enable on 2 Sites" }));
    expect(await screen.findByText("Not allowed")).toBeTruthy();
    expect(screen.getByText(/Reference: req-9/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enable on 2 Sites" })).toHaveProperty("disabled", true);
  });

  it("shows a failed preview with a retry and no confirm button", async () => {
    previewModuleOperation.mockResolvedValueOnce(failure(400, { reason: "module_not_found", message: "One or more modules do not exist." }));
    renderDialog();
    expect(await screen.findByText("One or more modules do not exist. Reference: req-9.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Enable on/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Matching Sites")).toBeTruthy();
  });

  it("has nothing to confirm when every Site is already in state", async () => {
    previewModuleOperation.mockResolvedValue({
      ok: true,
      data: preview({ summary: { ...preview().summary, eligible_sites: 0, expected_changes: 0, blocked_sites: 0, already_in_state_sites: 3, blocked_reasons: [] } }),
    });
    renderDialog();
    expect(await screen.findByText(/Nothing would change/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enable on 0 Sites" })).toHaveProperty("disabled", true);
  });
});

describe("uncertain operation retries", () => {
  it("resends the exact original body and locks the reason until the result is known", async () => {
    applyModuleOperation.mockResolvedValueOnce(failure(503)).mockResolvedValueOnce({ ok: true, data: applied });
    renderDialog();
    const reason = await screen.findByLabelText(/Reason/);
    fireEvent.change(reason, { target: { value: "Original rollout reason" } });
    fireEvent.click(screen.getByRole("button", { name: "Enable on 2 Sites" }));
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByLabelText(/Reason/)).toHaveProperty("disabled", true);
    fireEvent.click(retry);
    expect(await screen.findByText("The operation was committed.")).toBeTruthy();
    expect(applyModuleOperation.mock.calls[1][0]).toEqual(applyModuleOperation.mock.calls[0][0]);
    expect(applyModuleOperation.mock.calls[1][0].reason).toBe("Original rollout reason");
  });
});

describe("describeApplyError", () => {
  it("maps backend rejections to guidance", () => {
    expect(describeApplyError(failure(409, { reason: "preview_expired" }).error).retry).toBe("refresh");
    expect(describeApplyError(failure(503).error).retry).toBe("same");
    expect(describeApplyError(failure(400, { reason: "reason_required", message: "Give a reason." }).error).message).toContain("Give a reason.");
    expect(describeApplyError(failure(401).error).title).toBe("Sign-in required");
  });
});
