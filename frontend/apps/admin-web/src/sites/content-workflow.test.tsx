import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ContentWorkflowButtons, ContentWorkflowDialog, WORKFLOW_SCHEDULING_ENABLED } from "./content-workflow";

describe("shared content workflow", () => {
  it("offers only the actions the backend returned and no schedule control", () => {
    const onAction = vi.fn();
    render(
      <ContentWorkflowButtons
        title="Campus update"
        available={["submit"]}
        disabled={false}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit Campus update for review" }));
    expect(onAction).toHaveBeenCalledWith("submit");
    expect(screen.queryByRole("button", { name: "Publish Campus update" })).toBeNull();
    expect(screen.queryByRole("button", { name: /schedule/i })).toBeNull();
    expect(screen.queryByLabelText(/schedule/i)).toBeNull();
    expect(WORKFLOW_SCHEDULING_ENABLED).toBe(false);
  });

  it("requires a reviewer comment to reject and keeps a workflow error on screen", () => {
    const onConfirm = vi.fn();
    const view = render(
      <ContentWorkflowDialog
        noun="Post"
        action="reject"
        title="Campus update"
        comment=""
        error=""
        busy={false}
        onComment={() => undefined}
        onClose={() => undefined}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Reject Post?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm reject" })).toHaveProperty("disabled", true);
    expect(screen.queryByLabelText(/publish date|schedule/i)).toBeNull();

    view.rerender(
      <ContentWorkflowDialog
        noun="Post"
        action="reject"
        title="Campus update"
        comment="Needs a source."
        error="The Post workflow could not be updated."
        busy={false}
        onComment={() => undefined}
        onClose={() => undefined}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("could not be updated");
    fireEvent.click(screen.getByRole("button", { name: "Confirm reject" }));
    expect(onConfirm).toHaveBeenCalled();
  });
});
