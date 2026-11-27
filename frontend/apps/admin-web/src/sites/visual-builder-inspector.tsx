"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { MediaPickerResult } from "@/sites/media-picker";
import { documentsCopy } from "@uog/types";
import {
  SAFE_LINK_MESSAGE,
  fieldMessages,
  initialValue,
  isSafeLink,
  uid,
  type PropertySchema,
} from "@/sites/visual-builder-model";

const human = (key: string) => key.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase());

/** Style fields rendered as colour swatches rather than plain selects. */
const SWATCH_KEYS = ["panel_tone", "heading_color", "curve_border", "background", "text_color", "tone"];
const HEX_COLOUR = /^#[0-9A-Fa-f]{6}$/u;

interface TokenChoice {
  tokens: unknown[];
  enumLabels?: Record<string, string>;
  customHex: boolean;
}

/**
 * Recognises an enum field or a token-or-hex union such as Background, whose
 * branches are approved tokens plus an optional custom #RRGGBB colour.
 */
function tokenChoice(child: PropertySchema): TokenChoice | null {
  if (child.enum) return { tokens: child.enum, enumLabels: child.enumLabels, customHex: false };
  if (!child.oneOf) return null;
  const tokenBranch = child.oneOf.find((branch) => branch.enum);
  if (!tokenBranch?.enum) return null;
  const isHex = (branch: PropertySchema) => branch.type === "string" && branch.pattern === "^#[0-9A-Fa-f]{6}$";
  if (!child.oneOf.every((branch) => Boolean(branch.enum) || isHex(branch))) return null;
  return {
    tokens: tokenBranch.enum,
    enumLabels: tokenBranch.enumLabels ?? child.enumLabels,
    customHex: child.oneOf.some(isHex),
  };
}

const SWATCH_COLOURS: Record<string, string> = {none:"transparent",auto:"transparent",inherit:"transparent",default:"transparent",light:"#ffffff",paper:"#ffffff",white:"#ffffff",brand:"primary.main",blue:"primary.main",dark:"#172536",navy:"primary.dark",inverse:"#ffffff",muted:"#64748b",mist:"#edf3f7",gold:"#f8edce",brand_gradient:"linear-gradient(135deg,#075985,#003459)",blue_gradient:"linear-gradient(135deg,#075985,#38bdf8)",dark_gradient:"linear-gradient(135deg,#082f49,#111827)",navy_gradient:"linear-gradient(135deg,#003459,#075985)"};

/** Token swatches plus, for token-or-hex unions, a native colour picker. */
function TokenColourField({label, fieldKey, value, choice, optional, disabled, messages, description, onChange, onClear}: {
  label: string;
  fieldKey: string;
  value: unknown;
  choice: TokenChoice;
  optional: boolean;
  disabled: boolean;
  messages: string[];
  description?: string;
  onChange: (value: unknown) => void;
  onClear: () => void;
}) {
  const current = typeof value === "string" ? value : "";
  const custom = choice.customHex && HEX_COLOUR.test(current);
  const tokenColour = SWATCH_COLOURS[current];
  const pickerValue = custom ? current : tokenColour && HEX_COLOUR.test(tokenColour) ? tokenColour : "#075985";
  const helper = messages.join(" ")
    || description
    || (choice.customHex ? "Choose an approved token or pick any colour. Default removes the custom colour." : "");
  return <Box component="fieldset" sx={{border:0,p:0,m:0,minWidth:0}}>
    <Typography component="legend" variant="body2" sx={{mb:1,fontWeight:600}}>{label}</Typography>
    <Box role="group" aria-label={label} sx={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:1}}>
      {[...(optional?[""]:[]),...choice.tokens].map(option=>{const token=String(option);const active=current===token;const name=token?(choice.enumLabels?.[token]??human(token)):"Default";const colour=token==="gold"&&fieldKey!=="panel_tone"?"#d8ad45":SWATCH_COLOURS[token]??"transparent";
        return <Button key={token} type="button" disabled={disabled} aria-label={`${label}: ${name}`} aria-pressed={active} onClick={()=>{if(token)onChange(option);else onClear();}}
          sx={{minWidth:0,minHeight:64,p:.75,gap:.5,flexDirection:"column",border:active?"2px solid":"1px solid",borderColor:active?"primary.main":"divider",bgcolor:active?"action.selected":"transparent",fontSize:11,textTransform:"none","&:focus-visible":{outline:"3px solid",outlineColor:"primary.main",outlineOffset:2}}}>
          <Box aria-hidden sx={{width:26,height:26,borderRadius:"50%",border:1,borderColor:"divider",...(colour.startsWith("linear")?{background:colour}:{bgcolor:colour}),...(colour==="transparent"?{backgroundImage:"linear-gradient(135deg,transparent 45%,#94a3b8 46%,#94a3b8 54%,transparent 55%)"}:{}),boxShadow:active?"0 0 0 2px white,0 0 0 3px #075985":undefined}}/>{name}
        </Button>;
      })}
    </Box>
    {choice.customHex?<Box sx={{mt:1,display:"flex",alignItems:"center",gap:1,flexWrap:"wrap"}}>
      <Box component="label" sx={{display:"inline-flex",alignItems:"center",gap:1,border:"1px solid",borderColor:"divider",borderRadius:1,p:.5,pr:1.25,cursor:disabled?"default":"pointer","&:focus-within":{outline:"3px solid",outlineColor:"primary.main",outlineOffset:2}}}>
        <Box component="input" type="color" aria-label={`${label} custom colour`} value={pickerValue} disabled={disabled}
          onChange={(event)=>onChange(event.target.value)}
          sx={{width:40,height:30,p:0,border:0,borderRadius:.75,bgcolor:"transparent",cursor:"inherit","&::-webkit-color-swatch-wrapper":{p:0},"&::-webkit-color-swatch":{border:0,borderRadius:"4px"},"&::-moz-color-swatch":{border:0,borderRadius:"4px"}}}/>
        <Typography variant="caption" component="span" sx={{fontFamily:"monospace",fontSize:12}}>{custom?current:"Pick a colour"}</Typography>
      </Box>
      <Typography variant="caption" color="text.secondary">Or choose an approved token above.</Typography>
    </Box>:null}
    {messages.length||helper?<Typography variant="caption" color={messages.length?"error":"text.secondary"} role={messages.length?"alert":undefined} sx={{mt:choice.customHex?0.5:0,display:"block"}}>{messages.join(" ")||helper}</Typography>:null}
  </Box>;
}

export interface InspectorFieldsProps {
  schema: PropertySchema;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  chooseImage?: (apply: (result: MediaPickerResult) => void) => void;
  prefix?: string;
  path?: string;
  errors?: Record<string, string[]>;
  documentCategories?: Array<{id:string;name:string}>;
  documentLanguage?: string;
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
  documentCategories = [],
  documentLanguage="en",
}: InspectorFieldsProps) {
  if (schema.type === "object") {
    const record = (value ?? {}) as Record<string, unknown>;
    return (
      <Box sx={{ display: "grid", gap: 2 }}>
        {Object.entries(schema.properties ?? {})
          .filter(([key]) => key !== "id" && key !== "children")
          .sort(([a],[b])=>Number(a==="items")-Number(b==="items"))
          .map(([key, child]) => {
            const isDocumentWidget=Boolean(schema.properties?.categories);
            const documentCopy=documentsCopy(documentLanguage);
            const documentLabels:Record<string,string>={categories:documentCopy.categoryLabel,limit:documentCopy.limitLabel,display:documentCopy.displayLabel,sort:documentCopy.sortLabel,title:documentCopy.titleLabel};
            const label = prefix ? `${prefix} ${human(key)}` : isDocumentWidget?(documentLabels[key]??human(key)):human(key);
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
              if (child.items?.type === "string") {
                if(key==="categories")return <TextField key={key} select size="small" label={label} value={Array.isArray(record[key])?record[key] as string[]:[]} disabled={disabled} SelectProps={{multiple:true,native:true}}
                  helperText={messages.join(" ")||documentsCopy(documentLanguage).categoryHint} error={messages.length>0}
                  onChange={event=>update(typeof event.target.value==="string"?event.target.value.split(","):event.target.value as unknown as string[])}>
                  {documentCategories.map(category=><option key={category.id} value={category.id}>{category.name}</option>)}
                </TextField>;
                return <TextField key={key} size="small" label={label} value={Array.isArray(record[key]) ? (record[key] as string[]).join(", ") : ""}
                  disabled={disabled} multiline minRows={2} helperText={messages.join(" ")||"Enter values separated by commas."}
                  error={messages.length>0} onChange={event=>update(event.target.value.split(",").map(value=>value.trim()).filter(Boolean))}/>;
              }
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
                    documentCategories={documentCategories}
                    documentLanguage={documentLanguage}
                  />
                </Box>
              );
            }

            const choice = SWATCH_KEYS.includes(key) ? tokenChoice(child) : null;
            if (choice) {
              const optional=!schema.required?.includes(key);
              return <TokenColourField
                key={key}
                label={label}
                fieldKey={key}
                value={record[key]}
                choice={choice}
                optional={optional}
                disabled={disabled}
                messages={messages}
                description={child.description}
                onChange={update}
                onClear={()=>{const next={...record};delete next[key];onChange(next);}}
              />;
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
                  helperText={messages.join(" ") || child.description || undefined}
                  onChange={(event) => {
                    if(event.target.value===""){
                      const next={...record};delete next[key];onChange(next);
                    }else update(child.enum!.find((item) => String(item) === event.target.value));
                  }}
                >
                  {!schema.required?.includes(key)?<MenuItem value="">Default</MenuItem>:null}
                  {child.enum.map((option) => (
                    <MenuItem key={String(option)} value={String(option)}>{isDocumentWidget?(documentCopy[String(option) as keyof typeof documentCopy]??human(String(option))):child.enumLabels?.[String(option)]??human(String(option))}</MenuItem>
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
              documentCategories={documentCategories}
              documentLanguage={documentLanguage}
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
