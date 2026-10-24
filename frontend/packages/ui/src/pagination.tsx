"use client";

/**
 * Shared pagination controls for admin list screens.
 *
 * Renders previous/next buttons plus a range summary, all labelled for
 * assistive technology and reachable by keyboard. Page size is fixed
 * server-side (20), so this component only deals with page navigation.
 *
 * The whole control is a `<nav>` landmark so screen-reader users can jump
 * to it, and the current range is announced with `aria-live="polite"` so a
 * page change is audible.
 */
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";

export interface PaginationProps {
  /** 1-based current page. */
  page: number;
  /** Total number of items across all pages. */
  count: number;
  /** Items per page (backend enforces 20). */
  pageSize: number;
  onPageChange: (page: number) => void;
  /** Accessible name for the nav landmark, e.g. "Organizations pagination". */
  label?: string;
  disabled?: boolean;
}

/** Human-readable "1–20 of 41" summary. */
export function paginationSummary(
  page: number,
  count: number,
  pageSize: number,
): string {
  if (count === 0) return "No results";
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, count);
  return `${start}\u2013${end} of ${count}`;
}

export function Pagination({
  page,
  count,
  pageSize,
  onPageChange,
  label = "Pagination",
  disabled = false,
}: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(count / pageSize));
  const canPrevious = page > 1 && !disabled;
  const canNext = page < pageCount && !disabled;

  return (
    <Box
      component="nav"
      aria-label={label}
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 2,
        flexWrap: "wrap",
        py: 2,
        px: 1,
      }}
    >
      <Typography
        variant="body2"
        color="text.secondary"
        aria-live="polite"
        sx={{ minWidth: 120 }}
      >
        {paginationSummary(page, count, pageSize)}
      </Typography>

      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<ChevronLeftIcon />}
          disabled={!canPrevious}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          Previous
        </Button>
        <Typography variant="body2" color="text.secondary" sx={{ px: 1 }}>
          Page {page} of {pageCount}
        </Typography>
        <Button
          size="small"
          variant="outlined"
          endIcon={<ChevronRightIcon />}
          disabled={!canNext}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          Next
        </Button>
      </Box>
    </Box>
  );
}
