import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@uog/api-client";

import { ConfirmDialog } from "./confirm-dialog";

function renderDialog(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const onConfirm = props.onConfirm ?? vi.fn();
  const onCancel = props.onCancel ?? vi.fn();
  render(
    <ConfirmDialog
      open
      title="Deactivate this organization?"
      description="The organization stops appearing in active lists."
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onConfirm, onCancel };
}

describe("ConfirmDialog", () => {
  it("exposes the title and description via aria wiring", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");
    // aria-labelledby points at the title, aria-describedby at the body.
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: /deactivate this organization/i })).toBeTruthy();
  });

  it("confirms via the confirm button", async () => {
    const { onConfirm } = renderDialog({ confirmLabel: "Deactivate" });
    await userEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cancels via the cancel button without confirming", async () => {
    const { onConfirm, onCancel } = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cancels when Escape is pressed", async () => {
    const { onCancel } = renderDialog();
    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalled();
  });

  it("blocks interaction while pending and disables both buttons", () => {
    renderDialog({ pending: true, confirmLabel: "Deactivate" });
    expect(screen.getByRole("button", { name: /working/i })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty("disabled", true);
  });

  it("renders a failure inline without dismissing the dialog", () => {
    const error = new ApiError("The organization changed. Retrieve it and reconcile your changes.", 412, {
      code: "precondition_failed",
      requestId: "req-412",
    });
    renderDialog({ error });

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/reconcile your changes/i)).toBeTruthy();
    expect(screen.getByText(/req-412/)).toBeTruthy();
    // Dialog stays open so the user can retry or cancel.
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("renders destructive actions with the error colour", () => {
    renderDialog({ confirmColor: "error", confirmLabel: "Archive" });
    const confirm = screen.getByRole("button", { name: "Archive" });
    expect(confirm.className).toContain("MuiButton-colorError");
  });
});
