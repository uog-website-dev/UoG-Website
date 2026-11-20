import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { LazyMediaPickerDialog } from "./lazy-media-picker";

const picker = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("./media-picker", () => ({
  MediaPickerDialog: ({ onCancel }: { onCancel: () => void }) => {
    picker.render();
    return <div role="dialog" aria-label="Loaded media picker"><button onClick={onCancel}>Cancel picker</button></div>;
  },
}));

const props = {
  siteId: 11,
  onCancel: vi.fn(),
  onConfirm: vi.fn(),
};

it("loads the accessible picker only when opened and keeps cancel available", async () => {
  const view = render(<LazyMediaPickerDialog {...props} open={false} />);
  expect(picker.render).not.toHaveBeenCalled();

  view.rerender(<LazyMediaPickerDialog {...props} open />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancel picker" }));
  expect(picker.render).toHaveBeenCalled();
  expect(props.onCancel).toHaveBeenCalledOnce();
});
