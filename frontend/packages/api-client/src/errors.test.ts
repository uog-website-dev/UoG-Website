import { describe, expect, it } from "vitest";

import {
  ApiError,
  apiErrorFromResponse,
  codeForStatus,
  redactCredentials,
} from "./errors";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("apiErrorFromResponse", () => {
  it("parses the backend's structured error envelope", async () => {
    const response = jsonResponse(
      {
        error: {
          code: "validation_error",
          message: "The request is invalid.",
          details: { status: ['"INVALID" is not a valid choice.'] },
        },
        request_id: "1ea47c51-f2d7-402b-ad9a-4df619d03055",
      },
      400,
    );

    const error = await apiErrorFromResponse(response, null);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.code).toBe("validation_error");
    expect(error.message).toBe("The request is invalid.");
    expect(error.requestId).toBe("1ea47c51-f2d7-402b-ad9a-4df619d03055");
    expect(error.details).toEqual({ status: ['"INVALID" is not a valid choice.'] });
  });

  it("extracts per-field validation errors for form rendering", async () => {
    const response = jsonResponse(
      {
        error: {
          code: "validation_error",
          message: "The request is invalid.",
          details: { name: ["This field is required."], code: ["Already exists."] },
        },
        request_id: "abc",
      },
      400,
    );

    const error = await apiErrorFromResponse(response, null);

    expect(error.fieldErrors).toEqual({
      name: ["This field is required."],
      code: ["Already exists."],
    });
  });

  it("returns null fieldErrors for non-validation failures", async () => {
    const response = jsonResponse(
      { error: { code: "not_found", message: "gone", details: { detail: "x" } }, request_id: "abc" },
      404,
    );

    const error = await apiErrorFromResponse(response, null);

    expect(error.fieldErrors).toBeNull();
    expect(error.isAuthError).toBe(false);
  });

  it("flags 401 responses as auth errors", async () => {
    const response = jsonResponse(
      { error: { code: "not_authenticated", message: "no", details: {} }, request_id: null },
      401,
    );

    const error = await apiErrorFromResponse(response, "fallback-id");

    expect(error.isAuthError).toBe(true);
    // Falls back to the correlation id the client generated.
    expect(error.requestId).toBe("fallback-id");
  });

  it("falls back to the status code when the body is not the envelope", async () => {
    const response = new Response("<html>502 Bad Gateway</html>", { status: 502 });

    const error = await apiErrorFromResponse(response, "req-1");

    expect(error.status).toBe(502);
    expect(error.code).toBe("api_error");
    expect(error.message).toContain("502");
    expect(error.requestId).toBe("req-1");
  });

  it("treats an unknown backend code as api_error but keeps the message", async () => {
    const response = jsonResponse(
      { error: { code: "made_up_code", message: "custom text", details: null }, request_id: "r" },
      400,
    );

    const error = await apiErrorFromResponse(response, null);

    expect(error.code).toBe("validation_error"); // mapped from status 400
    expect(error.message).toBe("custom text");
  });
});

describe("codeForStatus", () => {
  it("maps the documented backend statuses to codes", () => {
    expect(codeForStatus(400)).toBe("validation_error");
    expect(codeForStatus(401)).toBe("not_authenticated");
    expect(codeForStatus(403)).toBe("permission_denied");
    expect(codeForStatus(404)).toBe("not_found");
    expect(codeForStatus(409)).toBe("conflict");
    expect(codeForStatus(412)).toBe("precondition_failed");
    expect(codeForStatus(428)).toBe("precondition_required");
    expect(codeForStatus(503)).toBe("service_unavailable");
    expect(codeForStatus(418)).toBe("api_error");
  });
});

describe("redactCredentials", () => {
  it("strips bearer tokens from a string", () => {
    const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def";
    const output = redactCredentials(input);
    expect(output).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(output).toContain("[redacted]");
  });

  it("strips token query parameters", () => {
    const input = "failed to call /api?access_token=super-secret-value&page=2";
    const output = redactCredentials(input);
    expect(output).not.toContain("super-secret-value");
    expect(output).toContain("page=2");
  });

  it("recurses into nested structures", () => {
    const input = {
      detail: "Bearer abc.def.ghi rejected",
      nested: { refresh_token: "zzz" },
      list: ["authorization: Bearer qqq"],
    };
    const output = redactCredentials(input);
    expect(JSON.stringify(output)).not.toContain("abc.def.ghi");
    expect(JSON.stringify(output)).not.toContain("zzz");
    expect(JSON.stringify(output)).not.toContain("qqq");
  });

  it("leaves unrelated strings untouched", () => {
    expect(redactCredentials("The request is invalid.")).toBe(
      "The request is invalid.",
    );
  });
});

describe("ApiError.fromUnknown", () => {
  it("passes an ApiError through unchanged", () => {
    const original = new ApiError("boom", 409, { code: "conflict" });
    expect(ApiError.fromUnknown(original)).toBe(original);
  });

  it("wraps a plain Error without leaking its type", () => {
    const error = ApiError.fromUnknown(new Error("kaboom"));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe("kaboom");
    expect(error.status).toBe(0);
  });

  it("wraps a non-Error rejection", () => {
    const error = ApiError.fromUnknown("just a string");
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe("An unexpected error occurred.");
  });
});

describe("ApiError credential safety", () => {
  it("redacts a bearer token that reaches the message", () => {
    const error = new ApiError("failed: Bearer secret-token-value", 500);
    expect(error.message).not.toContain("secret-token-value");
  });

  it("redacts a token that reaches the details", () => {
    const error = new ApiError("failed", 500, {
      details: { header: "Authorization: Bearer leak-me" },
    });
    expect(JSON.stringify(error.details)).not.toContain("leak-me");
  });
});
