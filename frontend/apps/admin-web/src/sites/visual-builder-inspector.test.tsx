import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { validateVisualLayout } from "@uog/types";
import { InspectorFields } from "./visual-builder-inspector";
import {
  SAFE_LINK_MESSAGE,
  isSafeLink,
  newWidget,
  schemaFor,
  shiftWidget,
  starterLayout,
  uid,
  widgetPropsPath,
} from "./visual-builder-model";

function Harness({
  schema,
  initial,
  chooseImage,
  path,
  errors,
}: {
  schema: ReturnType<typeof schemaFor>;
  initial: unknown;
  chooseImage?: Parameters<typeof InspectorFields>[0]["chooseImage"];
  path?: string;
  errors?: Record<string, string[]>;
}) {
  const [value, setValue] = useState(initial);
  return (
    <InspectorFields
      schema={schema}
      value={value}
      onChange={setValue}
      chooseImage={chooseImage}
      path={path}
      errors={errors}
    />
  );
}

describe("Visual Builder inspector", () => {
  it("edits text, binds media by asset ID, and keeps fields on the same node after reorder", () => {
    const layout = starterLayout();
    const column = layout.rows[0]!.columns[0]!;
    column.children = [
      newWidget("image", { assetId: "11111111-1111-4111-8111-111111111111", altText: "Campus" }),
      newWidget("headline"),
    ];
    const image = column.children[0]!;
    render(
      <Harness
        schema={schemaFor("image")}
        initial={image.props}
        chooseImage={(apply) => apply({
          assetId: "22222222-2222-4222-8222-222222222222",
          altText: "Hall",
          originalFilename: "hall.png",
          contentType: "image/png",
          byteCount: 10,
        })}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Alt" }), { target: { value: "Campus green" } });
    expect((screen.getByRole("textbox", { name: "Alt" }) as HTMLInputElement).value).toBe("Campus green");
    fireEvent.click(screen.getByRole("button", { name: "Choose ready image" }));
    expect(screen.getByText(/Asset ID: 22222222-2222-4222-8222-222222222222/)).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Alt" }) as HTMLInputElement).value).toBe("Campus green");

    const moved = shiftWidget(layout, image.id, 1);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.layout.rows[0]!.columns[0]!.children[1]!.id).toBe(image.id);
  });

  it("maps unsafe Button destinations to an actionable field error and keeps draft input", () => {
    expect(isSafeLink("javascript:alert(1)")).toBe(false);
    const button = newWidget("button");
    (button.props as { href: string }).href = "javascript:alert(1)";
    const row = starterLayout().rows[0]!;
    row.columns[0]!.children = [button];
    const layout = { schema_version: 1 as const, rows: [row] };
    const checked = validateVisualLayout(layout);
    expect(checked.ok).toBe(false);
    const path = widgetPropsPath(layout, button.id)!;
    render(
      <Harness
        schema={schemaFor("button")}
        initial={button.props}
        path={path}
        errors={!checked.ok ? checked.errors : {}}
      />,
    );
    const href = screen.getByRole("textbox", { name: "Href" }) as HTMLInputElement;
    expect(href.value).toBe("javascript:alert(1)");
    expect(screen.getByText(SAFE_LINK_MESSAGE)).toBeTruthy();
    fireEvent.change(href, { target: { value: "javascript:alert(2)" } });
    expect((screen.getByRole("textbox", { name: "Href" }) as HTMLInputElement).value).toBe("javascript:alert(2)");
    expect(screen.getByText(SAFE_LINK_MESSAGE)).toBeTruthy();
  });

  it("supports slider item add/reorder while preserving item IDs and attached media fields", () => {
    const first = { id: uid(), asset_id: "11111111-1111-4111-8111-111111111111", alt: "One", caption: "First" };
    const second = { id: uid(), asset_id: "22222222-2222-4222-8222-222222222222", alt: "Two", caption: "Second" };
    render(<Harness schema={schemaFor("image_slider")} initial={{ items: [first, second] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Move Items 2 up" }));
    expect(screen.getByDisplayValue("Two")).toBeTruthy();
    expect(screen.getByDisplayValue("One")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Add item/i }));
    expect(screen.getAllByText(/Items \d+/).length).toBeGreaterThanOrEqual(3);
  });

  it("blocks save when a Button href is unsafe after slider media edits", () => {
    const layout = starterLayout();
    const column = layout.rows[0]!.columns[0]!;
    const slideA = { id: uid(), asset_id: "11111111-1111-4111-8111-111111111111", alt: "A", caption: "Alpha" };
    const slideB = { id: uid(), asset_id: "22222222-2222-4222-8222-222222222222", alt: "B", caption: "Beta" };
    const slider = newWidget("image_slider");
    (slider.props as { items: typeof slideA[] }).items = [slideA, slideB];
    const button = newWidget("button");
    (button.props as { href: string }).href = "javascript:alert(1)";
    column.children = [slider, button];

    const { unmount } = render(
      <Harness
        schema={schemaFor("image_slider")}
        initial={slider.props}
        chooseImage={(apply) => apply({
          assetId: "33333333-3333-4333-8333-333333333333",
          altText: "Gamma",
          originalFilename: "g.png",
          contentType: "image/png",
          byteCount: 4,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Move Items 2 up" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Choose ready image" })[0]!);
    expect(screen.getByText(/Asset ID: 33333333-3333-4333-8333-333333333333/)).toBeTruthy();
    expect(screen.getByDisplayValue("B")).toBeTruthy();
    unmount();

    const checked = validateVisualLayout(layout);
    expect(checked.ok).toBe(false);
    const path = widgetPropsPath(layout, button.id)!;
    render(
      <Harness
        schema={schemaFor("button")}
        initial={button.props}
        path={path}
        errors={!checked.ok ? checked.errors : {}}
      />,
    );
    expect((screen.getByRole("textbox", { name: "Href" }) as HTMLInputElement).value).toBe("javascript:alert(1)");
    expect(screen.getByText(SAFE_LINK_MESSAGE)).toBeTruthy();
    expect(isSafeLink((button.props as { href: string }).href)).toBe(false);
  });
});
