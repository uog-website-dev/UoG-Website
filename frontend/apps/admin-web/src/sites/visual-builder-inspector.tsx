"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { MediaPickerResult } from "@/sites/media-picker";
import {
  SAFE_LINK_MESSAGE,
  fieldMessages,
  initialValue,
  isSafeLink,
  uid,
  type PropertySchema,
} from "@/sites/visual-builder-model";

const human = (key: string) => key.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase());

export interface InspectorFieldsProps {
  schema: PropertySchema;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  chooseImage?: (apply: (result: MediaPickerResult) => void) => void;
  prefix?: string;
  path?: string;
  errors?: Record<string, string[]>;
}

/**
 * Registry-driven inspector controls for typed props. Media binds by asset ID,
 * href fields surface safe-link guidance, and repeater lists support add/reorder/remove
 * while preserving item IDs.
 */
export function InspectorFields({
  schema,
  value,
  onChange,
  disabled = false,
  chooseImage,
  prefix = "",
  path = "",
  errors = {},
}: InspectorFieldsProps) {
  if (schema.type === "object") {
    const record = (value ?? {}) as Record<string, unknown>;
    return (
      <Box sx={{ display: "grid", gap: 2 }}>
        {Object.entries(schema.properties ?? {})
          .filter(([key]) => key !== "id" && key !== "children")
          .map(([key, child]) => {
            const label = prefix ? `${prefix} ${human(key)}` : human(key);
            const fieldPath = path ? `${path}.${key}` : key;
            const messages = fieldMessages(errors, fieldPath);
            const update = (next: unknown) => onChange({ ...record, [key]: next });

            if (key === "asset_id") {
              return (
                <Box key={key} sx={{ display: "grid", gap: 0.75 }}>
                  <Typography variant="subtitle2">{label}</Typography>
                  <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                    {record[key] ? `Asset ID: ${String(record[key])}` : "No image selected."}
                  </Typography>
                  <Button
                    disabled={disabled || !chooseImage}
                    onClick={() => chooseImage?.((asset) => {
                      const next: Record<string, unknown> = { ...record, asset_id: asset.assetId };
                      const currentAlt = typeof record.alt === "string" ? record.alt.trim() : "";
                      if (!currentAlt && asset.altText) {
                        next.alt = [...asset.altText].slice(0, 255).join("");
                      }
                      onChange(next);
                    })}
                  >
                    Choose ready image
                  </Button>
                  <Typography variant="caption" color="text.secondary">
                    Selection stores the eligible Site asset ID only. Other fields stay unchanged.
                  </Typography>
                  {messages.length ? <Typography color="error" variant="caption" role="alert">{messages.join(" ")}</Typography> : null}
                </Box>
              );
            }

            if (key === "alt") {
              return (
                <TextField
                  key={key}
                  size="small"
                  label={label}
                  value={String(record[key] ?? "")}
                  disabled={disabled}
                  multiline
                  minRows={2}
                  error={messages.length > 0}
                  helperText={messages.join(" ") || "Describe the image for screen readers. Prefer the library alt text when it fits."}
                  slotProps={{ htmlInput: { maxLength: child.maxLength ?? 255, "aria-label": label } }}
                  onChange={(event) => update(event.target.value)}
                />
              );
            }

            if (key === "href" || Boolean(child.pattern?.includes("mailto"))) {
              const href = String(record[key] ?? "");
              const localError = href && !isSafeLink(href) ? SAFE_LINK_MESSAGE : "";
              const mapped = messages.map((message) => (
                /safe link|Invalid identifier|date or safe/i.test(message) ? SAFE_LINK_MESSAGE : message
              ));
              const helper = [...new Set([...mapped, localError].filter(Boolean))].join(" ")
                || "Site path, http(s) URL or mailto only.";
              return (
                <TextField
                  key={key}
                  size="small"
                  label={label}
                  value={href}
                  disabled={disabled}
                  error={Boolean(localError || messages.length)}
                  helperText={helper}
                  slotProps={{ htmlInput: { maxLength: child.maxLength, "aria-label": label } }}
                  onChange={(event) => update(event.target.value)}
                />
              );
            }

            if (child.type === "array") {
              return (
                <Box key={key}>
                  <Typography variant="subtitle2">{label}</Typography>
                  <InspectorFields
                    schema={child}
                    value={record[key] ?? []}
                    onChange={update}
                    disabled={disabled}
                    chooseImage={chooseImage}
                    prefix={label}
                    path={fieldPath}
                    errors={errors}
                  />
                </Box>
              );
            }

            if (child.enum) {
              return (
                <TextField
                  key={key}
                  select
                  size="small"
                  label={label}
                  disabled={disabled}
                  value={String(record[key] ?? (schema.required?.includes(key)?child.enum[0]:""))}
                  error={messages.length > 0}
                  helperText={messages.join(" ") || undefined}
                  onChange={(event) => {
                    if(event.target.value===""){
                      const next={...record};delete next[key];onChange(next);
                    }else update(child.enum!.find((item) => String(item) === event.target.value));
                  }}
                >
                  {!schema.required?.includes(key)?<MenuItem value="">Default</MenuItem>:null}
                  {child.enum.map((option) => (
                    <MenuItem key={String(option)} value={String(option)}>{human(String(option))}</MenuItem>
                  ))}
                </TextField>
              );
            }

            if (child.type === "boolean") {
              return (
                <Button
                  key={key}
                  size="small"
                  aria-pressed={Boolean(record[key])}
                  disabled={disabled}
                  onClick={() => update(!record[key])}
                >
                  {label}: {record[key] ? "On" : "Off"}
                </Button>
              );
            }

            // html is the approved Editor rich-text prop; free CSS/script props are not in the registry.
            return (
              <TextField
                key={key}
                size="small"
                label={label}
                value={String(record[key] ?? "")}
                disabled={disabled}
                multiline={key === "text" || key === "html" || key === "body" || key === "question"}
                minRows={key === "html" ? 3 : undefined}
                type={child.type === "integer" || child.type === "number" ? "number" : "text"}
                error={messages.length > 0}
                helperText={messages.join(" ") || (key === "html" ? "Approved Editor HTML only. Scripts and CSS are not accepted outside this field." : undefined)}
                slotProps={{ htmlInput: { maxLength: child.maxLength, min: child.minimum, max: child.maximum, "aria-label": label } }}
                onChange={(event) => update(
                  child.type === "integer" || child.type === "number"
                    ? Number(event.target.value)
                    : event.target.value,
                )}
              />
            );
          })}
      </Box>
    );
  }

  if (schema.type === "array") {
    const items = (value ?? []) as Record<string, unknown>[];
    const maxItems = schema.maxItems ?? 50;
    return (
      <Box sx={{ display: "grid", gap: 2 }}>
        {items.map((item, index) => (
          <Paper key={String(item.id ?? index)} variant="outlined" sx={{ p: 1.5, minWidth: 0, display: "grid", gap: 1 }}>
            <Typography variant="caption" component="p">{prefix || "Item"} {index + 1}</Typography>
            <InspectorFields
              schema={schema.items!}
              value={item}
              onChange={(next) => onChange(items.map((old, i) => (i === index ? next : old)))}
              disabled={disabled}
              chooseImage={chooseImage}
              prefix={`${prefix} ${index + 1}`.trim()}
              path={`${path}[${index}]`}
              errors={errors}
            />
            {"children" in item ? (
              <Typography variant="caption">Select nested content from the outline.</Typography>
            ) : null}
            <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
              <Button
                size="small"
                disabled={disabled || index === 0}
                aria-label={`Move ${prefix || "item"} ${index + 1} up`}
                onClick={() => {
                  const next = items.slice();
                  const [row] = next.splice(index, 1);
                  next.splice(index - 1, 0, row!);
                  onChange(next);
                }}
              >
                Move up
              </Button>
              <Button
                size="small"
                disabled={disabled || index === items.length - 1}
                aria-label={`Move ${prefix || "item"} ${index + 1} down`}
                onClick={() => {
                  const next = items.slice();
                  const [row] = next.splice(index, 1);
                  next.splice(index + 1, 0, row!);
                  onChange(next);
                }}
              >
                Move down
              </Button>
              <Button
                color="error"
                size="small"
                disabled={disabled}
                aria-label={`Remove ${prefix || "item"} ${index + 1}`}
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
            </Box>
          </Paper>
        ))}
        <Button
          size="small"
          disabled={disabled || items.length >= maxItems}
          onClick={() => {
            const item = initialValue(schema.items!) as Record<string, unknown>;
            if (schema.items?.properties?.children) {
              item.children = [{ id: uid(), type: "headline", props: { text: "Slide headline", level: 2 } }];
            }
            onChange([...items, item]);
          }}
        >
          Add {prefix ? prefix.replace(/s$/i, "").toLowerCase() || "item" : "item"}
        </Button>
      </Box>
    );
  }

  return null;
}
