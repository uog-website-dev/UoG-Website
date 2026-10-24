import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Pagination, paginationSummary } from "./pagination";

describe("paginationSummary", () => {
  it("describes a middle range", () => {
    expect(paginationSummary(2, 41, 20)).toBe("21\u201340 of 41");
  });

  it("clamps the last page to the total", () => {
    expect(paginationSummary(3, 41, 20)).toBe("41\u201341 of 41");
  });

  it("reports an empty result set", () => {
    expect(paginationSummary(1, 0, 20)).toBe("No results");
  });
});

describe("Pagination", () => {
  it("is a labelled navigation landmark", () => {
    render(
      <Pagination
        page={1}
        count={41}
        pageSize={20}
        onPageChange={vi.fn()}
        label="Organizations pagination"
      />,
    );
    expect(screen.getByRole("navigation", { name: "Organizations pagination" })).toBeTruthy();
  });

  it("announces the current range", () => {
    render(<Pagination page={2} count={41} pageSize={20} onPageChange={vi.fn()} />);
    expect(screen.getByText("21\u201340 of 41")).toBeTruthy();
    expect(screen.getByText("Page 2 of 3")).toBeTruthy();
  });

  it("disables Previous on the first page", () => {
    render(<Pagination page={1} count={41} pageSize={20} onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /previous/i })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /next/i })).toHaveProperty("disabled", false);
  });

  it("disables Next on the last page", () => {
    render(<Pagination page={3} count={41} pageSize={20} onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /next/i })).toHaveProperty("disabled", true);
  });

  it("moves to the next page on click", async () => {
    const onPageChange = vi.fn();
    render(<Pagination page={1} count={41} pageSize={20} onPageChange={onPageChange} />);

    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("moves to the previous page on click", async () => {
    const onPageChange = vi.fn();
    render(<Pagination page={2} count={41} pageSize={20} onPageChange={onPageChange} />);

    await userEvent.click(screen.getByRole("button", { name: /previous/i }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("disables both controls when the parent marks the block disabled", () => {
    render(<Pagination page={2} count={41} pageSize={20} onPageChange={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: /previous/i })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /next/i })).toHaveProperty("disabled", true);
  });
});
