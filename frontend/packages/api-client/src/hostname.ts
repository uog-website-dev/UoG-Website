/**
 * Canonical hostname rules, mirroring backend/apps/sites/hostnames.py.
 *
 * A domain value is a *hostname* — never a URL, path, query string or email
 * address — so the same normalization runs on both sides of the wire:
 * trim, lower-case, strip a trailing dot, drop a default port (80/443),
 * punycode internationalized text, then require at least two valid labels
 * within the 253-character limit.
 *
 * The form uses this for immediate feedback before the round trip; the
 * backend re-validates and is the sole authority. Error strings match the
 * backend's messages so an operator sees identical wording wherever the
 * value is rejected.
 */

/** Stored shape: lowercase labels, at least two, no leading/trailing hyphens. */
const STORED = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const URL_MARKS = ["://", "/", "\\", "?", "#", "@", " "] as const;
const DEFAULT_PORTS = new Set(["80", "443"]);

export type HostnameResult =
  | { hostname: string; error?: undefined }
  | { hostname?: undefined; error: string };

/** Normalize `raw` to the canonical hostname, or explain why it is invalid. */
export function normalizeHostname(raw: string): HostnameResult {
  if (typeof raw !== "string") {
    return { error: "A hostname is required." };
  }
  const host = raw.trim().toLowerCase();
  if (host === "") {
    return { error: "A hostname is required." };
  }
  if (URL_MARKS.some((mark) => host.includes(mark))) {
    return {
      error: "Domain values are hostnames, not URLs or paths.",
    };
  }

  let value = host.endsWith(".") ? host.slice(0, -1) : host;

  if (value.includes(":")) {
    const parts = value.split(":");
    const port = parts[1];
    if (parts.length !== 2 || parts[0] === "" || !DEFAULT_PORTS.has(port)) {
      return {
        error: "Only a hostname is stored. Non-default ports are rejected.",
      };
    }
    value = parts[0].endsWith(".") ? parts[0].slice(0, -1) : parts[0];
  }

  try {
    // URL parsing punycode-encodes internationalized labels and lower-cases.
    value = new URL(`http://${value}`).hostname;
  } catch {
    return { error: "The hostname is not valid internationalized text." };
  }

  if (value.length > 253 || !STORED.test(value)) {
    return { error: "The hostname is not a valid domain name." };
  }
  return { hostname: value };
}
