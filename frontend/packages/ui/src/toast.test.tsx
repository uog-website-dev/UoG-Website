import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ToastProvider, useToast } from "./toast";

/** Renders a button that fires each toast API method when clicked. */
function ToastHarness() {
  const toast = useToast();
  return (
    <div>
      <button type="button" onClick={() => toast.success("Saved.")}>
        save
      </button>
      <button type="button" onClick={() => toast.error("It broke.", { severity: "error" })}>
        fail
      </button>
    </div>
  );
}

function renderToasts() {
  return render(
    <ToastProvider>
      <ToastHarness />
    </ToastProvider>,
  );
}

describe("useToast", () => {
  it("throws when used outside a provider", () => {
    // React logs the error; silence it for this negative test.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<ToastHarness />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });

  it("shows a success toast that can be dismissed", async () => {
    renderToasts();

    await userEvent.click(screen.getByRole("button", { name: "save" }));
    expect(screen.getByText("Saved.")).toBeTruthy();

    // The dismiss button is labelled, so it is keyboard reachable.
    await userEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByText("Saved.")).toBeNull();
  });

  it("shows an error toast", async () => {
    renderToasts();

    await userEvent.click(screen.getByRole("button", { name: "fail" }));
    expect(screen.getByText("It broke.")).toBeTruthy();
  });

  it("replaces the current toast when a new one is shown", async () => {
    renderToasts();

    await userEvent.click(screen.getByRole("button", { name: "save" }));
    expect(screen.getByText("Saved.")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "fail" }));
    expect(screen.queryByText("Saved.")).toBeNull();
    expect(screen.getByText("It broke.")).toBeTruthy();
  });

  it("auto-dismisses after the configured duration", () => {
    vi.useFakeTimers();
    renderToasts();

    // fireEvent, not userEvent: userEvent awaits real timers, which are
    // faked here and would stall the interaction.
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(screen.getByText("Saved.")).toBeTruthy();

    // Default duration is 6000ms.
    act(() => {
      vi.advanceTimersByTime(6100);
    });
    expect(screen.queryByText("Saved.")).toBeNull();

    vi.useRealTimers();
  });
});
