import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { PostRichEditor } from "./post-rich-editor";

it("applies Paragraph even when the menu already displays Paragraph for an existing heading", async () => {
  const previous = Object.getOwnPropertyDescriptor(document, "execCommand");
  const saved: string[] = [];
  Object.defineProperty(document, "execCommand", {configurable: true, value: (name: string, _ui: boolean, tag: string) => {
    if (name === "formatBlock" && tag === "p") {
      document.querySelector<HTMLElement>('[aria-label="Article body"]')!.innerHTML = "<p>Existing heading</p>";
    }
    return true;
  }});
  try {
    render(<PostRichEditor value="<h2>Existing heading</h2>" onChange={html=>saved.push(html)} onSave={()=>{}}/>);
    fireEvent.mouseDown(screen.getByRole("combobox", {name: /Text style/}));
    fireEvent.click(await screen.findByRole("option", {name: "Paragraph"}));
    await waitFor(()=>expect(saved).toContain("<p>Existing heading</p>"));
    expect(screen.getByRole("textbox", {name: "Article body"}).querySelector("h2")).toBeNull();
  } finally {
    if (previous) Object.defineProperty(document, "execCommand", previous);
    else Reflect.deleteProperty(document, "execCommand");
  }
});
