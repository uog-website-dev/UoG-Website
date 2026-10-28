import { describe, expect, it } from "vitest";

import { normalizeHostname } from "./hostname";

/**
 * The normalizer mirrors backend/apps/sites/hostnames.py — these tests pin
 * the documented contract so a drift between client feedback and backend
 * rejection is caught here.
 */
describe("normalizeHostname", () => {
  it("accepts and canonicalizes a plain hostname", () => {
    expect(normalizeHostname("  ETH.UoG.Edu.et ").hostname).toBe(
      "eth.uog.edu.et",
    );
  });

  it("strips a trailing dot and default ports", () => {
    expect(normalizeHostname("uog.edu.et.").hostname).toBe("uog.edu.et");
    expect(normalizeHostname("uog.edu.et:443").hostname).toBe("uog.edu.et");
    expect(normalizeHostname("uog.edu.et:80").hostname).toBe("uog.edu.et");
  });

  it("rejects a required-but-empty value", () => {
    expect(normalizeHostname("").error).toBe("A hostname is required.");
    expect(normalizeHostname("   ").error).toBe("A hostname is required.");
  });

  it("rejects protocol prefixes, paths, query strings and fragments", () => {
    for (const raw of [
      "https://uog.edu.et",
      "uog.edu.et/path",
      "uog.edu.et?x=1",
      "uog.edu.et#frag",
      "user@uog.edu.et",
      "uog.edu.et\\share",
      "uog.edu.et host",
    ]) {
      expect(normalizeHostname(raw).error).toBe(
        "Domain values are hostnames, not URLs or paths.",
      );
    }
  });

  it("rejects non-default ports", () => {
    expect(normalizeHostname("uog.edu.et:8080").error).toBe(
      "Only a hostname is stored. Non-default ports are rejected.",
    );
    expect(normalizeHostname(":443").error).toBe(
      "Only a hostname is stored. Non-default ports are rejected.",
    );
    expect(normalizeHostname("uog.edu.et:443:1").error).toBe(
      "Only a hostname is stored. Non-default ports are rejected.",
    );
  });

  it("rejects single labels, bad labels and over-long names", () => {
    expect(normalizeHostname("localhost").error).toBe(
      "The hostname is not a valid domain name.",
    );
    expect(normalizeHostname("-bad.uog.edu.et").error).toBe(
      "The hostname is not a valid domain name.",
    );
    expect(normalizeHostname(`${"a".repeat(64)}.uog.edu.et`).error).toBe(
      "The hostname is not a valid domain name.",
    );
    expect(normalizeHostname(`${"a.".repeat(140)}uog`).error).toBe(
      "The hostname is not a valid domain name.",
    );
  });

  it("punycodes internationalized labels", () => {
    const parsed = normalizeHostname("üniversity.uog.edu.et");
    expect(parsed.hostname).toBe("xn--niversity-p9a.uog.edu.et");
  });

  it("reports non-string input as required instead of crashing", () => {
    expect(normalizeHostname(undefined as unknown as string).error).toBe(
      "A hostname is required.",
    );
  });
});
