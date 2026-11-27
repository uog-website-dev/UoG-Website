/**
 * Allowlisted inline CSS for the shared article / page rich-text editor.
 * Rejects urls, expressions and any property outside the professional toolkit.
 */

const ALLOWED_PROPS = new Set([
  "color",
  "background-color",
  "text-shadow",
  "width",
  "max-width",
  "height",
  "float",
  "display",
  "margin",
  "margin-left",
  "margin-right",
  "margin-top",
  "margin-bottom",
  "text-align",
  "border",
  "border-collapse",
  "border-color",
  "border-width",
  "border-style",
  "padding",
  "vertical-align",
]);

const LENGTH = "-?[\\d.]+(?:px|%|em|rem|pt)?";
const LENGTH_OR_AUTO = `(?:${LENGTH}|auto)`;
const COLOR = "(?:#[0-9a-f]{3,8}|rgba?\\(\\s*[\\d.%\\s,]+\\s*\\)|[a-z]+)";
const SAFE_VALUE = new RegExp(
  `^(?:${COLOR}|[a-z]+|${LENGTH_OR_AUTO}(?:\\s+${LENGTH_OR_AUTO}){0,3}|(?:${LENGTH}\\s+){2,4}${COLOR}|none|solid|dashed|dotted|left|right|center|justify|top|middle|bottom|block|inline|inline-block)$`,
  "i",
);

/** Return a sanitized style attribute, or empty string when nothing safe remains. */
export function sanitizeInlineStyle(value: string | null | undefined): string {
  if (!value) return "";
  const parts: string[] = [];
  for (const raw of value.split(";")) {
    const chunk = raw.trim();
    if (!chunk) continue;
    const colon = chunk.indexOf(":");
    if (colon <= 0) continue;
    const prop = chunk.slice(0, colon).trim().toLowerCase();
    const val = chunk.slice(colon + 1).trim();
    if (!ALLOWED_PROPS.has(prop)) continue;
    if (/url\s*\(|expression\s*\(|@import|javascript:|<|>|{|}/i.test(val)) continue;
    if (!SAFE_VALUE.test(val.replace(/\s+/g, " "))) continue;
    parts.push(`${prop}: ${val.replace(/\s+/g, " ")}`);
  }
  return parts.join("; ");
}

export type ImageAlign = "left" | "center" | "right" | "full";

export function imageLayoutStyle(align: ImageAlign, widthPercent: number): string {
  const width = Math.max(10, Math.min(100, Math.round(widthPercent)));
  if (align === "left") {
    return sanitizeInlineStyle(`width: ${width}%; max-width: 100%; float: left; margin: 0 1rem 1rem 0; display: block`);
  }
  if (align === "right") {
    return sanitizeInlineStyle(`width: ${width}%; max-width: 100%; float: right; margin: 0 0 1rem 1rem; display: block`);
  }
  if (align === "full") {
    return sanitizeInlineStyle("width: 100%; max-width: 100%; display: block; margin: 1rem 0");
  }
  return sanitizeInlineStyle(`width: ${width}%; max-width: 100%; display: block; margin: 1rem auto`);
}
