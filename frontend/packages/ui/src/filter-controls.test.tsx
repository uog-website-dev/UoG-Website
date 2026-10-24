import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { FilterBar, SelectFilter, TextFilter } from "./filter-controls";

function FilterHarness({ onApply, onReset }: { onApply: () => void; onReset: () => void }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  return (
    <FilterBar label="Organization filters" onApply={onApply} onReset={onReset}>
      <TextFilter label="Search" value={search} onChange={setSearch} />
      <SelectFilter
        label="Status"
        value={status}
        onChange={setStatus}
        options={[
          { value: "ACTIVE", label: "Active" },
          { value: "INACTIVE", label: "Inactive" },
        ]}
      />
    </FilterBar>
  );
}

describe("FilterBar", () => {
  it("renders as a labelled search landmark", () => {
    render(<FilterHarness onApply={vi.fn()} onReset={vi.fn()} />);
    expect(screen.getByRole("search", { name: "Organization filters" })).toBeTruthy();
  });

  it("labels every field so screen readers announce them", () => {
    render(<FilterHarness onApply={vi.fn()} onReset={vi.fn()} />);
    // Label association: the visible label text is bound to the control.
    expect(screen.getByLabelText("Search")).toBeTruthy();
    expect(screen.getByLabelText("Status")).toBeTruthy();
  });

  it("submits the filters when Apply is pressed", async () => {
    const onApply = vi.fn();
    render(<FilterHarness onApply={onApply} onReset={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("submits the filters when Enter is pressed in a field", async () => {
    const onApply = vi.fn();
    render(<FilterHarness onApply={onApply} onReset={vi.fn()} />);

    const search = screen.getByLabelText("Search");
    await userEvent.type(search, "college{Enter}");
    expect(onApply).toHaveBeenCalled();
  });

  it("resets the filters when Reset is pressed", async () => {
    const onReset = vi.fn();
    render(<FilterHarness onApply={vi.fn()} onReset={onReset} />);

    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("shows the active filter count", () => {
    render(
      <FilterBar label="Organization filters" onApply={vi.fn()} onReset={vi.fn()} activeCount={3}>
        <span />
      </FilterBar>,
    );
    expect(screen.getByText(/Organization filters \(3\)/)).toBeTruthy();
  });
});

describe("SelectFilter", () => {
  it("renders as a labelled combobox", () => {
    render(
      <SelectFilter
        label="Status"
        value=""
        onChange={vi.fn()}
        options={[{ value: "ACTIVE", label: "Active" }]}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Status" })).toBeTruthy();
  });

  it("offers an explicit All option when includeAll is set", async () => {
    render(
      <SelectFilter
        label="Status"
        value=""
        onChange={vi.fn()}
        options={[{ value: "ACTIVE", label: "Active" }]}
      />,
    );

    // Open the listbox and read its options.
    await userEvent.click(screen.getByRole("combobox", { name: "Status" }));
    const options = await screen.findAllByRole("option");
    const labels = options.map((option) => option.textContent);

    // "All" is the empty-value sentinel that clears the filter.
    expect(labels).toContain("All");
    expect(labels).toContain("Active");
  });

  it("omits the All option when includeAll is false", async () => {
    render(
      <SelectFilter
        label="Status"
        value="ACTIVE"
        onChange={vi.fn()}
        includeAll={false}
        options={[{ value: "ACTIVE", label: "Active" }]}
      />,
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Status" }));
    const options = await screen.findAllByRole("option");
    const labels = options.map((option) => option.textContent);

    expect(labels).not.toContain("All");
    expect(labels).toEqual(["Active"]);
  });
});
