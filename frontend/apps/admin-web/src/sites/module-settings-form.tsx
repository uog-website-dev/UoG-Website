"use client";

/**
 * Schema-driven settings form for one Site's module assignment.
 *
 * Fields are generated from the module's approved `configuration_schema`,
 * so there is no free-text JSON box anywhere in this console: a property of
 * type `boolean` renders a checkbox, `string` a labelled text field and
 * `integer` a numeric field — each with its `required` marker, hint text and
 * inline validation wired through `aria-describedby`/`aria-invalid`.
 *
 * The client gives immediate feedback (required, blank/untrimmed, whole
 * numbers) but never claims a payload is acceptable: the Django serializer
 * and `normalize_site_module_configuration` validate authoritatively, and
 * the parent screen renders their 400 answer verbatim. Because schema
 * property codes can never describe secrets (the backend forbids it when
 * approving a schema), no secret can be typed or stored through this form.
 */
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import type {
  ModuleProperty,
  ModuleSettings,
  ModuleSettingValue,
} from "@/modules/validation";

/** DOM id for a property's input so the error summary can link to it. */
export function settingsFieldId(property: ModuleProperty): string {
  return `module-setting-${property.code}`;
}

function hintFor(property: ModuleProperty): string {
  const type =
    property.type === "integer"
      ? "Whole number."
      : property.type === "string"
        ? "Up to 500 characters."
        : "";
  const required = property.required ? "Required." : "Optional.";
  return `${type} ${required}`.trim();
}

export interface ModuleSettingsFormProps {
  properties: ModuleProperty[];
  values: ModuleSettings;
  /** Per-property errors (client-side or the server's field errors). */
  errors: Record<string, string>;
  disabled?: boolean;
  onChange: (code: string, value: ModuleSettingValue) => void;
}

export function ModuleSettingsForm({
  properties,
  values,
  errors,
  disabled = false,
  onChange,
}: ModuleSettingsFormProps) {
  if (properties.length === 0) {
    return null;
  }

  return (
    <Box
      sx={{
        display: "grid",
        gap: 2,
        gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
      }}
    >
      {properties.map((property) => {
        const error = errors[property.code];
        const fieldId = settingsFieldId(property);
        const errorId = error ? `${fieldId}-error` : undefined;
        const hintId = !error ? `${fieldId}-hint` : undefined;
        const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

        if (property.type === "boolean") {
          return (
            <Box key={property.code} sx={{ minWidth: 0 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    id={fieldId}
                    checked={values[property.code] === true}
                    onChange={(event) =>
                      onChange(property.code, event.target.checked)
                    }
                    disabled={disabled}
                    inputProps={{ "aria-describedby": describedBy }}
                  />
                }
                label={
                  <>
                    {property.label}
                    {property.required ? (
                      <Box component="span" sx={{ color: "error.main", ml: 0.5 }}>
                        *
                      </Box>
                    ) : null}
                  </>
                }
              />
              <Typography
                id={hintId}
                variant="caption"
                color={error ? "error" : "text.secondary"}
                role={error ? "alert" : undefined}
                sx={{ display: "block", ml: 4.5 }}
              >
                {error ?? hintFor(property)}
              </Typography>
            </Box>
          );
        }

        return (
          <TextField
            key={property.code}
            id={fieldId}
            name={property.code}
            label={property.label}
            value={String(values[property.code] ?? "")}
            onChange={(event) => onChange(property.code, event.target.value)}
            size="small"
            fullWidth
            required={property.required}
            disabled={disabled}
            error={Boolean(error)}
            helperText={error ?? hintFor(property)}
            inputMode={property.type === "integer" ? "numeric" : undefined}
            inputProps={{
              "aria-describedby": describedBy,
              "aria-invalid": error ? true : undefined,
            }}
            FormHelperTextProps={{ id: error ? errorId : hintId }}
          />
        );
      })}
    </Box>
  );
}
