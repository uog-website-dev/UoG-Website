"use client";

/**
 * Shared form field and validation-message components.
 *
 * Admin forms must surface the backend's per-field validation errors (DRF
 * sends `{field: [messages]}` on a 400) without each screen re-implementing
 * the wiring. These components make that consistent and accessible:
 *
 *   - `FormField` wraps a text field, binding the label, helper text and
 *     error message to the input via `aria-describedby` / `aria-invalid`,
 *     and announces the error with `role="alert"` when it appears;
 *   - `FormErrorSummary` lists every field error at the top of a form and
 *     links to the offending input, which is the WCAG-preferred pattern for
 *     validating on submit;
 *   - `fieldErrorsFrom` adapts the `ApiError.fieldErrors` shape from
 *     @uog/api-client so screens can pass an error straight in.
 */
import Box from "@mui/material/Box";
import FormHelperText from "@mui/material/FormHelperText";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useId } from "react";

import { ApiError } from "@uog/api-client";

/**
 * Adapt an ApiError into a `{field: message}` map for rendering.
 *
 * Returns an empty map when the error carries no per-field details (e.g. a
 * 401 or a network failure), so callers can distinguish "the form is wrong"
 * from "the request failed".
 */
export function fieldErrorsFrom(
  error: ApiError | null | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  const fields = error?.fieldErrors;
  if (!fields) return result;
  for (const [field, messages] of Object.entries(fields)) {
    if (messages.length > 0) result[field] = messages.join(" ");
  }
  return result;
}

export interface FormFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Backend validation message for this field, if any. */
  error?: string;
  /** Neutral helper text shown when there is no error. */
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  multiline?: boolean;
  /** Renders as a controlled <textarea> when multiline. */
  rows?: number;
  inputMode?: "text" | "numeric" | "email" | "url" | "search";
  name?: string;
}

/** A labelled text input with accessible validation messaging. */
export function FormField({
  label,
  value,
  onChange,
  error,
  hint,
  required = false,
  disabled = false,
  placeholder,
  multiline = false,
  rows,
  inputMode,
  name,
}: FormFieldProps) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint && !error ? `${id}-hint` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <TextField
      id={id}
      name={name}
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      required={required}
      disabled={disabled}
      placeholder={placeholder}
      error={Boolean(error)}
      multiline={multiline}
      rows={multiline ? (rows ?? 3) : undefined}
      inputMode={inputMode}
      fullWidth
      size="small"
      inputProps={{
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      }}
      FormHelperTextProps={{ id: error ? errorId : hintId }}
      helperText={error ?? hint ?? " "}
    />
  );
}

export interface FormErrorSummaryProps {
  /** Flat field->message map, e.g. from `fieldErrorsFrom`. */
  errors: Record<string, string>;
  /** Heading shown above the list. */
  title?: string;
  /**
   * Optional map of field name to the DOM id of its input, so each listed
   * error can link straight to the field that caused it.
   */
  fieldIds?: Record<string, string>;
}

/**
 * Error summary rendered at the top of a form after a failed submit.
 *
 * Uses `role="alert"` so it is announced immediately, and lists each field
 * with a link to its input when an id is provided. Screens should focus
 * this region after a failed submit for keyboard users.
 */
export function FormErrorSummary({
  errors,
  title = "Check the form and try again",
  fieldIds,
}: FormErrorSummaryProps) {
  const entries = Object.entries(errors);
  const headingId = useId();

  if (entries.length === 0) return null;

  return (
    <Box
      role="alert"
      aria-labelledby={headingId}
      sx={{
        border: 1,
        borderColor: "error.main",
        borderRadius: 2,
        bgcolor: "error.light",
        color: "error.contrastText",
        p: 2,
        display: "flex",
        flexDirection: "column",
        gap: 1,
      }}
    >
      <Typography id={headingId} variant="subtitle2" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2, display: "flex", flexDirection: "column", gap: 0.5 }}>
        {entries.map(([field, message]) => {
          const targetId = fieldIds?.[field];
          return (
            <Box component="li" key={field} sx={{ fontSize: 14 }}>
              {targetId ? (
                <Box
                  component="a"
                  href={`#${targetId}`}
                  sx={{ color: "inherit", fontWeight: 700 }}
                >
                  {field}:
                </Box>
              ) : (
                <strong>{field}:</strong>
              )}{" "}
              {message}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
