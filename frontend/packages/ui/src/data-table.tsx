"use client";

/**
 * Shared data table for admin list screens.
 *
 * Wraps MUI's Table so every list in the console renders the same markup and
 * behaves the same way for keyboard and screen-reader users:
 *
 *   - a caption describes the table (visually hidden by default, so the
 *     surrounding heading stays the visible title);
 *   - column headers are `<th scope="col">` and, when sortable, are real
 *     `<button>`s inside the header cell, so they are reachable by Tab and
 *     activate on Enter/Space;
 *   - the sort direction is exposed with `aria-sort` on the header cell;
 *   - rows can carry actions; each row's actions are announced with an
 *     `aria-label` naming the row's primary identifier.
 *
 * The table renders its own loading/empty/error states so a screen never has
 * to coordinate them separately.
 */
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Skeleton from "@mui/material/Skeleton";
import MuiTable from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

import { ApiErrorState, EmptyState, LoadingState } from "./async-states";
import { ApiError } from "@uog/api-client";

export type SortDirection = "asc" | "desc";

export interface SortState {
  /** Column `field` the table is sorted by. */
  field: string;
  direction: SortDirection;
}

export interface TableColumn<T> {
  /** Unique key, also used as the sort field when `sortable`. */
  field: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  /** Column width hint, e.g. "20%" or 160. */
  width?: string | number;
  align?: "left" | "right" | "center";
}

export interface DataTableSelection<T> {
  selected: ReadonlySet<string | number>;
  onChange: (next: Set<string | number>) => void;
  /** Defaults to every row. */
  isRowSelectable?: (row: T) => boolean;
  /** Accessible name for the row checkbox. */
  getCheckboxLabel?: (row: T) => string;
}

export interface DataTableProps<T> {
  /** Describes the table for assistive technology. */
  caption: string;
  columns: TableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string | number;
  /** Rendered in the last cell of each row (e.g. row action buttons). */
  renderActions?: (row: T) => ReactNode;
  sort?: SortState | null;
  onSortChange?: (sort: SortState) => void;
  /** Optional multi-select column for bulk actions. */
  selection?: DataTableSelection<T>;
  /** Rendered instead of the table body when there are no rows. */
  emptyState?: ReactNode;
  /** Shows skeleton rows while a request is in flight. */
  loading?: boolean;
  /** Number of skeleton rows to draw while loading. */
  loadingRows?: number;
  /** When set, renders the error state instead of the table. */
  error?: ApiError | null;
  onRetry?: () => void;
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  getRowKey,
  renderActions,
  sort,
  onSortChange,
  selection,
  emptyState,
  loading = false,
  loadingRows = 5,
  error = null,
  onRetry,
}: DataTableProps<T>) {
  if (error) {
    return <ApiErrorState error={error} onRetry={onRetry} />;
  }

  const hasActions = Boolean(renderActions);
  const selectableRows = selection
    ? rows.filter((row) => selection.isRowSelectable?.(row) ?? true)
    : [];
  const selectableKeys = selectableRows.map((row) => getRowKey(row));
  const selectedSelectableCount = selectableKeys.filter((key) => selection?.selected.has(key)).length;
  const allSelectableSelected = selectableKeys.length > 0 && selectedSelectableCount === selectableKeys.length;
  const someSelectableSelected = selectedSelectableCount > 0 && !allSelectableSelected;

  const handleHeaderClick = (column: TableColumn<T>) => {
    if (!column.sortable || !onSortChange) return;
    const isActive = sort?.field === column.field;
    const nextDirection: SortDirection =
      isActive && sort?.direction === "asc" ? "desc" : "asc";
    onSortChange({ field: column.field, direction: nextDirection });
  };

  function toggleAllSelectable() {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (allSelectableSelected) {
      for (const key of selectableKeys) next.delete(key);
    } else {
      for (const key of selectableKeys) next.add(key);
    }
    selection.onChange(next);
  }

  function toggleRow(key: string | number) {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selection.onChange(next);
  }

  return (
    <TableContainer>
      <MuiTable
        aria-label={caption}
        size="small"
        sx={{ "& th, & td": { whiteSpace: "nowrap" } }}
      >
        <TableHead>
          <TableRow>
            {selection ? (
              <TableCell padding="checkbox" scope="col">
                <Checkbox
                  size="small"
                  indeterminate={someSelectableSelected}
                  checked={allSelectableSelected}
                  disabled={loading || selectableKeys.length === 0}
                  onChange={toggleAllSelectable}
                  inputProps={{ "aria-label": `Select all rows in ${caption}` }}
                />
              </TableCell>
            ) : null}
            {columns.map((column) => {
              const isActive = sort?.field === column.field;
              const ariaSort = !column.sortable
                ? undefined
                : isActive
                  ? sort?.direction === "asc"
                    ? "ascending"
                    : "descending"
                  : "none";
              return (
                <TableCell
                  key={column.field}
                  scope="col"
                  align={column.align ?? "left"}
                  width={column.width}
                  aria-sort={ariaSort}
                  sx={{ fontWeight: 700, color: "text.secondary" }}
                >
                  {column.sortable && onSortChange ? (
                    <TableSortLabel
                      active={isActive}
                      direction={isActive ? sort?.direction : "asc"}
                      onClick={() => handleHeaderClick(column)}
                      IconComponent={
                        isActive
                          ? sort?.direction === "asc"
                            ? ArrowUpwardIcon
                            : ArrowDownwardIcon
                          : UnfoldMoreIcon
                      }
                    >
                      {column.header}
                    </TableSortLabel>
                  ) : (
                    column.header
                  )}
                </TableCell>
              );
            })}
            {hasActions ? (
              <TableCell
                scope="col"
                align="right"
                sx={{ fontWeight: 700, color: "text.secondary" }}
              >
                Actions
              </TableCell>
            ) : null}
          </TableRow>
        </TableHead>

        <TableBody>
          {loading
            ? Array.from({ length: loadingRows }).map((_, index) => (
                <TableRow key={`skeleton-${index}`}>
                  {selection ? (
                    <TableCell padding="checkbox">
                      <Skeleton variant="rectangular" width={18} height={18} />
                    </TableCell>
                  ) : null}
                  {columns.map((column) => (
                    <TableCell key={column.field}>
                      <Skeleton variant="text" width={120} />
                    </TableCell>
                  ))}
                  {hasActions ? (
                    <TableCell align="right">
                      <Skeleton variant="text" width={60} />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            : rows.map((row) => {
                const key = getRowKey(row);
                const canSelect = selection ? (selection.isRowSelectable?.(row) ?? true) : false;
                return (
                <TableRow key={key} hover selected={selection?.selected.has(key)}>
                  {selection ? (
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={selection.selected.has(key)}
                        disabled={!canSelect}
                        onChange={() => toggleRow(key)}
                        inputProps={{
                          "aria-label": selection.getCheckboxLabel?.(row) ?? `Select row ${key}`,
                        }}
                      />
                    </TableCell>
                  ) : null}
                  {columns.map((column) => (
                    <TableCell key={column.field} align={column.align ?? "left"}>
                      {column.render(row)}
                    </TableCell>
                  ))}
                  {hasActions ? (
                    <TableCell align="right">{renderActions?.(row)}</TableCell>
                  ) : null}
                </TableRow>
                );
              })}
        </TableBody>
      </MuiTable>

      {!loading && rows.length === 0 ? (
        <Box sx={{ borderTop: 1, borderColor: "divider" }}>
          {emptyState ?? <EmptyState />}
        </Box>
      ) : null}
    </TableContainer>
  );
}

/**
 * Visually hidden caption text for tables that already have a visible
 * heading nearby but still need an accessible name.
 */
export function VisuallyHiddenCaption({ children }: { children: ReactNode }) {
  return (
    <Typography
      component="caption"
      sx={{
        position: "absolute",
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: "hidden",
        clip: "rect(0 0 0 0)",
        whiteSpace: "nowrap",
        border: 0,
      }}
    >
      {children}
    </Typography>
  );
}
