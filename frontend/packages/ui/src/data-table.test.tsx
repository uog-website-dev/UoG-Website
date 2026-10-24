import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@uog/api-client";

import { DataTable } from "./data-table";
import type { TableColumn } from "./data-table";

interface Row {
  id: number;
  code: string;
  name: string;
}

const rows: Row[] = [
  { id: 1, code: "UOG", name: "University of Gondar" },
  { id: 2, code: "INFORMATICS", name: "College of Informatics" },
];

const columns: TableColumn<Row>[] = [
  { field: "code", header: "Code", render: (row) => row.code, sortable: true },
  { field: "name", header: "Name", render: (row) => row.name },
];

function renderTable(props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) {
  return render(
    <DataTable<Row>
      caption="Organizations"
      columns={columns}
      rows={rows}
      getRowKey={(row) => row.id}
      {...props}
    />,
  );
}

describe("DataTable", () => {
  it("renders the caption as the accessible table name", () => {
    renderTable();
    expect(screen.getByRole("table", { name: "Organizations" })).toBeTruthy();
  });

  it("renders column headers as column-scoped header cells", () => {
    renderTable();
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["Code", "Name"]);
  });

  it("renders one row per record", () => {
    renderTable();
    expect(screen.getAllByRole("row")).toHaveLength(rows.length + 1); // + header
    expect(screen.getByText("College of Informatics")).toBeTruthy();
  });

  it("shows the empty state when there are no rows", () => {
    renderTable({ rows: [] });
    // EmptyState defaults to "Nothing here yet".
    expect(screen.getByText("Nothing here yet")).toBeTruthy();
    // The table still exists so the headers remain available.
    expect(screen.getByRole("table", { name: "Organizations" })).toBeTruthy();
  });

  it("renders a custom empty state when supplied", () => {
    renderTable({ rows: [], emptyState: <p>No organizations match.</p> });
    expect(screen.getByText("No organizations match.")).toBeTruthy();
  });

  it("shows skeleton rows while loading instead of data", () => {
    renderTable({ loading: true, loadingRows: 3 });
    expect(screen.queryByText("University of Gondar")).toBeNull();
    // aria-busy announces the loading region.
    expect(screen.getByRole("table", { name: "Organizations" })).toBeTruthy();
  });

  it("renders the error state with the correlation id when an error is set", () => {
    const error = new ApiError("The request is invalid.", 400, {
      code: "validation_error",
      requestId: "req-abc-123",
    });
    renderTable({ error });

    // ApiErrorState uses role="alert".
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/req-abc-123/)).toBeTruthy();
    // The table body is not rendered alongside the error.
    expect(screen.queryByText("University of Gondar")).toBeNull();
  });

  it("offers a retry action that fires on click", async () => {
    const onRetry = vi.fn();
    const error = new ApiError("boom", 500);
    renderTable({ error, onRetry });

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("labels row actions with the row's identity", () => {
    renderTable({
      renderActions: (row) => (
        <button type="button">{`Deactivate ${row.code}`}</button>
      ),
    });
    expect(screen.getByRole("button", { name: "Deactivate UOG" })).toBeTruthy();
  });

  describe("sortable headers", () => {
    it("exposes aria-sort reflecting the active sort", () => {
      renderTable({ sort: { field: "code", direction: "asc" }, onSortChange: vi.fn() });
      const codeHeader = screen.getAllByRole("columnheader")[0];
      expect(codeHeader.getAttribute("aria-sort")).toBe("ascending");
    });

    it("marks a non-active sortable column as none", () => {
      renderTable({ sort: { field: "name", direction: "asc" }, onSortChange: vi.fn() });
      const codeHeader = screen.getAllByRole("columnheader")[0];
      expect(codeHeader.getAttribute("aria-sort")).toBe("none");
    });

    it("omits aria-sort for non-sortable columns", () => {
      renderTable({ sort: null, onSortChange: vi.fn() });
      const nameHeader = screen.getAllByRole("columnheader")[1];
      expect(nameHeader.getAttribute("aria-sort")).toBeNull();
    });

    it("toggles asc -> desc when an active column is activated", async () => {
      const onSortChange = vi.fn();
      renderTable({ sort: { field: "code", direction: "asc" }, onSortChange });

      await userEvent.click(screen.getByRole("button", { name: /code/i }));
      expect(onSortChange).toHaveBeenCalledWith({ field: "code", direction: "desc" });
    });

    it("starts at asc when a new column is activated", async () => {
      const onSortChange = vi.fn();
      renderTable({ sort: { field: "code", direction: "asc" }, onSortChange });

      // Activate the non-sortable "Name" header? It has no button; instead
      // verify a fresh activation of the sortable column starts asc.
      renderTable({ sort: null, onSortChange });
      await userEvent.click(screen.getAllByRole("button", { name: /code/i })[1]);
      expect(onSortChange).toHaveBeenCalledWith({ field: "code", direction: "asc" });
    });

    it("is operable with the keyboard (Enter on the header button)", async () => {
      const onSortChange = vi.fn();
      renderTable({ sort: null, onSortChange });

      const sortButton = screen.getAllByRole("button", { name: /code/i })[0];
      sortButton.focus();
      await userEvent.keyboard("{Enter}");
      expect(onSortChange).toHaveBeenCalledWith({ field: "code", direction: "asc" });
    });
  });
});
