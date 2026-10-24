import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@uog/api-client";

import { FormErrorSummary, FormField, fieldErrorsFrom } from "./form-fields";

describe("fieldErrorsFrom", () => {
  it("flattens per-field messages into a single string per field", () => {
    const error = new ApiError("invalid", 400, {
      code: "validation_error",
      details: { name: ["This field is required."], code: ["Too long.", "Must be unique."] },
    });

    expect(fieldErrorsFrom(error)).toEqual({
      name: "This field is required.",
      code: "Too long. Must be unique.",
    });
  });

  it("returns an empty map when there are no per-field details", () => {
    const error = new ApiError("nope", 500);
    expect(fieldErrorsFrom(error)).toEqual({});
  });

  it("returns an empty map for null/undefined", () => {
    expect(fieldErrorsFrom(null)).toEqual({});
    expect(fieldErrorsFrom(undefined)).toEqual({});
  });
});

describe("FormField", () => {
  it("binds the label to the input", () => {
    render(<FormField label="Code" value="" onChange={vi.fn()} />);
    expect(screen.getByLabelText("Code")).toBeTruthy();
  });

  it("marks the input invalid and wires aria-describedby when errored", () => {
    render(<FormField label="Code" value="" onChange={vi.fn()} error="This field is required." />);
    const input = screen.getByLabelText("Code");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    // The described element carries the message.
    expect(document.getElementById(describedBy!)?.textContent).toContain(
      "This field is required.",
    );
  });

  it("does not mark a valid field invalid", () => {
    render(<FormField label="Code" value="UOG" onChange={vi.fn()} hint="Uppercase." />);
    const input = screen.getByLabelText("Code");
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("calls onChange with the typed value", async () => {
    const onChange = vi.fn();
    render(<FormField label="Code" value="" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText("Code"), "U");
    expect(onChange).toHaveBeenCalledWith("U");
  });
});

describe("FormErrorSummary", () => {
  it("renders nothing when there are no errors", () => {
    const { container } = render(<FormErrorSummary errors={{}} />);
    expect(container.innerHTML).toBe("");
  });

  it("announces itself as an alert and lists every field", () => {
    render(
      <FormErrorSummary
        errors={{ name: "This field is required.", code: "Already exists." }}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toBeTruthy();
    expect(screen.getByText(/name:/i)).toBeTruthy();
    expect(screen.getByText(/code:/i)).toBeTruthy();
    expect(screen.getByText("This field is required.")).toBeTruthy();
    expect(screen.getByText("Already exists.")).toBeTruthy();
  });

  it("links each error to its input when ids are supplied", () => {
    render(
      <FormErrorSummary
        errors={{ name: "Required." }}
        fieldIds={{ name: "field-name" }}
      />,
    );
    const link = screen.getByRole("link", { name: /name:/i });
    expect(link.getAttribute("href")).toBe("#field-name");
  });
});
