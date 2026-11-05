import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@uog/api-client";

import { useAsync } from "./useAsync";

interface Payload {
  results: string[];
}

/** Harness exposing the hook's state on data-testid attributes. */
function AsyncHarness({
  fetcher,
  isEmpty,
}: {
  fetcher: () => Promise<Payload>;
  isEmpty?: (data: Payload) => boolean;
}) {
  const state = useAsync(fetcher, [], { isEmpty });

  return (
    <div>
      <span data-testid="status">{state.status}</span>
      <span data-testid="loading">{String(state.loading)}</span>
      <span data-testid="empty">{String(state.empty)}</span>
      <span data-testid="error">{state.error ? state.error.message : "none"}</span>
      <span data-testid="request-id">{state.error?.requestId ?? "none"}</span>
      <span data-testid="count">{state.data?.results.length ?? -1}</span>
      <button type="button" onClick={state.reload}>
        reload
      </button>
    </div>
  );
}

describe("useAsync", () => {
  it("shares a StrictMode mount read but still performs fresh reloads", async () => {
    const fetcher = vi.fn().mockResolvedValue({ results: ["a"] });
    render(<StrictMode><AsyncHarness fetcher={fetcher} /></StrictMode>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("success"));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "reload" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });

  it("does not share responses between separate component instances", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ results: ["a"] }).mockResolvedValueOnce({ results: ["b", "c"] });
    render(<StrictMode><AsyncHarness fetcher={fetcher} /><AsyncHarness fetcher={fetcher} /></StrictMode>);
    await waitFor(() => expect(screen.getAllByTestId("status").map((node) => node.textContent)).toEqual(["success", "success"]));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.getAllByTestId("count").map((node) => node.textContent)).toEqual(["1", "2"]);
  });

  it("starts a fresh read when scope changes and ignores the old response", async () => {
    let resolveOld!: (value: Payload) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Payload>((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ results: ["new scope"] });
    function Scoped({ scope }: { scope: number }) {
      const state = useAsync<Payload>(() => fetcher(scope), [scope]);
      return <span data-testid="scoped-count">{state.data?.results.length ?? -1}</span>;
    }
    const view = render(<Scoped scope={1} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(1));
    view.rerender(<Scoped scope={2} />);
    await waitFor(() => expect(screen.getByTestId("scoped-count").textContent).toBe("1"));
    resolveOld({ results: ["old", "old"] });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("scoped-count").textContent).toBe("1");
  });

  it("transitions loading -> success and exposes the data", async () => {
    const fetcher = vi.fn().mockResolvedValue({ results: ["a", "b"] });
    render(<AsyncHarness fetcher={fetcher} />);

    expect(screen.getByTestId("status").textContent).toBe("loading");
    expect(screen.getByTestId("loading").textContent).toBe("true");

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("success"),
    );
    expect(screen.getByTestId("count").textContent).toBe("2");
    expect(screen.getByTestId("loading").textContent).toBe("false");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("transitions to error and surfaces the structured message", async () => {
    const fetcher = vi.fn().mockRejectedValue(
      new ApiError("The request is invalid.", 400, {
        code: "validation_error",
        requestId: "req-err-1",
      }),
    );
    render(<AsyncHarness fetcher={fetcher} />);

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("error"),
    );
    expect(screen.getByTestId("error").textContent).toBe("The request is invalid.");
    expect(screen.getByTestId("request-id").textContent).toBe("req-err-1");
  });

  it("normalises a non-ApiError rejection into the shared error shape", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("plain failure"));
    render(<AsyncHarness fetcher={fetcher} />);

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("error"),
    );
    expect(screen.getByTestId("error").textContent).toBe("plain failure");
    expect(screen.getByTestId("request-id").textContent).toBe("none");
  });

  it("reports empty only when the success payload matches isEmpty", async () => {
    const fetcher = vi.fn().mockResolvedValue({ results: [] });
    render(<AsyncHarness fetcher={fetcher} isEmpty={(data) => data.results.length === 0} />);

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("success"),
    );
    expect(screen.getByTestId("empty").textContent).toBe("true");
  });

  it("does not report empty when the payload has items", async () => {
    const fetcher = vi.fn().mockResolvedValue({ results: ["a"] });
    render(<AsyncHarness fetcher={fetcher} isEmpty={(data) => data.results.length === 0} />);

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("success"),
    );
    expect(screen.getByTestId("empty").textContent).toBe("false");
  });

  it("defaults empty to false when no isEmpty predicate is given", async () => {
    const fetcher = vi.fn().mockResolvedValue({ results: [] });
    render(<AsyncHarness fetcher={fetcher} />);

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("success"),
    );
    expect(screen.getByTestId("empty").textContent).toBe("false");
  });

  it("re-runs the fetcher when reload is triggered", async () => {
    const fetcher = vi.fn().mockResolvedValue({ results: ["a"] });
    render(<AsyncHarness fetcher={fetcher} />);

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("success"),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "reload" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("status").textContent).toBe("success");
  });

  it("clears a previous error when a reload succeeds", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("boom", 500))
      .mockResolvedValueOnce({ results: ["ok"] });

    render(<AsyncHarness fetcher={fetcher} />);

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("error"),
    );
    expect(screen.getByTestId("error").textContent).toBe("boom");

    await userEvent.click(screen.getByRole("button", { name: "reload" }));

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("success"),
    );
    expect(screen.getByTestId("error").textContent).toBe("none");
  });
});
