"use client";

/**
 * Shared filter controls for admin list screens.
 *
 * Provides a labelled text field, a labelled select and a toolbar that
 * groups them with Apply/Reset actions. Every control has a real `<label>`
 * bound by `htmlFor`/`id`, so screen readers announce the field name and
 * keyboard users can Tab between fields in a predictable order.
 *
 * Filters are applied on submit (Apply) rather than on every keystroke, so
 * the backend is not queried per character and the URL stays shareable.
 * Reset clears every field and re-submits the empty filter set.
 */
import FilterListIcon from "@mui/icons-material/FilterList";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import OutlinedInput from "@mui/material/OutlinedInput";
import Select from "@mui/material/Select";
import type { SelectChangeEvent } from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import type { ReactNode } from "react";
import { useId } from "react";

export interface FilterOption {
  value: string;
  label: string;
}

export interface TextFilterProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible description rendered below the field. */
  hint?: string;
  /** Id of an element describing this field (error message). */
  errorId?: string;
  invalid?: boolean;
}

/** A single labelled text filter. */
export function TextFilter({
  label,
  value,
  onChange,
  placeholder,
  hint,
  errorId,
  invalid = false,
}: TextFilterProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <TextField
      id={id}
      label={label}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      size="small"
      error={invalid}
      helperText={hint}
      FormHelperTextProps={{ id: hintId }}
      inputProps={{
        "aria-describedby": describedBy,
        "aria-invalid": invalid || undefined,
      }}
      sx={{ minWidth: 200 }}
    />
  );
}

export interface SelectFilterProps {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  /** Adds an explicit "All" option that clears the filter. */
  includeAll?: boolean;
  allLabel?: string;
}

/** A single labelled select filter. */
export function SelectFilter({
  label,
  value,
  options,
  onChange,
  includeAll = true,
  allLabel = "All",
}: SelectFilterProps) {
  const id = useId();
  const labelId = `${id}-label`;

  return (
    <FormControl size="small" sx={{ minWidth: 180 }}>
      <InputLabel id={labelId}>{label}</InputLabel>
      <Select
        id={id}
        labelId={labelId}
        label={label}
        value={value}
        input={<OutlinedInput label={label} />}
        onChange={(event: SelectChangeEvent) => onChange(event.target.value)}
      >
        {includeAll ? <MenuItem value="">{allLabel}</MenuItem> : null}
        {options.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

export interface FilterBarProps {
  children: ReactNode;
  onApply: () => void;
  onReset: () => void;
  /** Accessible name for the filter region, e.g. "Organization filters". */
  label: string;
  /** Shows a count of active filters as a hint next to the heading. */
  activeCount?: number;
  resetDisabled?: boolean;
}

/**
 * Groups filter fields with Apply/Reset actions.
 *
 * Rendered as a `<form>` so Enter submits the filters from any field, which
 * is the expected keyboard behaviour. Submitting calls `onApply`.
 */
export function FilterBar({
  children,
  onApply,
  onReset,
  label,
  activeCount = 0,
  resetDisabled = false,
}: FilterBarProps) {
  return (
    <Box
      component="form"
      role="search"
      aria-label={label}
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
      sx={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "flex-end",
        gap: 2,
        p: 2,
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        bgcolor: "background.paper",
      }}
    >
      <Box
        component="span"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          color: "text.secondary",
          alignSelf: "center",
          mr: 1,
        }}
      >
        <FilterListIcon fontSize="small" aria-hidden="true" />
        <Box
          component="span"
          sx={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}
        >
          {label}
          {activeCount > 0 ? ` (${activeCount})` : ""}
        </Box>
      </Box>

      {children}

      <Box sx={{ display: "flex", gap: 1, ml: "auto" }}>
        <Button
          type="submit"
          variant="contained"
          size="small"
          disabled={resetDisabled}
        >
          Apply
        </Button>
        <Button
          type="button"
          variant="outlined"
          size="small"
          onClick={onReset}
          disabled={resetDisabled}
        >
          Reset
        </Button>
      </Box>
    </Box>
  );
}
