import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { RichTextEditor } from "./rich-text-editor";

it("exposes professional formatting controls for color, highlight, shadow and tables", () => {
  render(<RichTextEditor value="<p>Body</p>" onChange={() => {}} onSave={() => {}} />);
  expect(screen.getByRole("combobox", { name: /Text color/i })).toBeTruthy();
  expect(screen.getByRole("combobox", { name: /Highlight/i })).toBeTruthy();
  expect(screen.getByRole("combobox", { name: /Shadow/i })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Insert table" })).toBeTruthy();
});

it("applies Paragraph even when the menu already displays Paragraph for an existing heading", async () => {
  const previous = Object.getOwnPropertyDescriptor(document, "execCommand");
  const saved: string[] = [];
  Object.defineProperty(document, "execCommand", {configurable: true, value: (name: string, _ui: boolean, tag: string) => {
    if (name === "formatBlock" && tag === "p") {
      document.querySelector<HTMLElement>('[aria-label="Content"]')!.innerHTML = "<p>Existing heading</p>";
    }
    return true;
  }});
  try {
    render(<RichTextEditor value="<h2>Existing heading</h2>" onChange={html=>saved.push(html)} onSave={()=>{}}/>);
    fireEvent.mouseDown(screen.getByRole("combobox", {name: /Text style/}));
    fireEvent.click(await screen.findByRole("option", {name: "Paragraph"}));
    await waitFor(()=>expect(saved).toContain("<p>Existing heading</p>"));
    expect(screen.getByRole("textbox", {name: "Content"}).querySelector("h2")).toBeNull();
  } finally {
    if (previous) Object.defineProperty(document, "execCommand", previous);
    else Reflect.deleteProperty(document, "execCommand");
  }
});
