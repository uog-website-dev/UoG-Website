import { describe, expect, it } from "vitest";
import {
  duplicateSection,
  moveRow,
  moveWidget,
  orderedIds,
  removeNode,
  resizeColumns,
  shiftWidget,
  starterLayout,
  newWidget,
  newRow,
} from "./visual-builder-model";
import type { VisualLayout } from "@uog/types";

function fixture(): VisualLayout {
  const layout = starterLayout();
  const slider = newWidget("image_slider");
  layout.rows[0]!.columns[1]!.children.push(slider);
  return layout;
}

describe("Visual Builder composition", () => {
  it("produces the same ordered IDs for pointer-equivalent and keyboard row moves", () => {
    const layout = fixture();
    const first = layout.rows[0]!.id;
    const second = layout.rows[1]!.id;
    const byKeyboard = moveRow(layout, second, -1);
    expect(byKeyboard.ok).toBe(true);
    if (!byKeyboard.ok) return;
    const byPointer = moveRow(layout, second, -1);
    expect(byPointer.ok).toBe(true);
    if (!byPointer.ok) return;
    expect(orderedIds(byKeyboard.layout)).toEqual(orderedIds(byPointer.layout));
    expect(byKeyboard.layout.rows.map((row) => row.id)).toEqual([second, first]);
  });

  it("moves a slider across columns with keyboard or pointer and keeps stable widget IDs", () => {
    const layout = fixture();
    const slider = layout.rows[0]!.columns[1]!.children.find((widget) => widget.type === "image_slider")!;
    const left = layout.rows[0]!.columns[0]!;
    const pointer = moveWidget(layout, slider.id, { columnId: left.id, index: 1 });
    const keyboard = moveWidget(layout, slider.id, { columnId: left.id, index: 1 });
    expect(pointer.ok && keyboard.ok).toBe(true);
    if (!pointer.ok || !keyboard.ok) return;
    expect(pointer.layout.rows[0]!.columns[0]!.children.map((widget) => widget.id))
      .toEqual(keyboard.layout.rows[0]!.columns[0]!.children.map((widget) => widget.id));
    expect(pointer.layout.rows[0]!.columns[0]!.children.map((widget) => widget.id)).toContain(slider.id);
    expect(pointer.layout.rows[0]!.columns[1]!.children.map((widget) => widget.id)).not.toContain(slider.id);
  });

  it("keeps the original structure on an invalid drop and restores logical focus after delete", () => {
    const layout = fixture();
    const original = JSON.stringify(layout);
    const invalid = moveWidget(layout, layout.rows[0]!.id, { columnId: layout.rows[0]!.columns[0]!.id, index: 0 });
    expect(invalid.ok).toBe(false);
    expect(JSON.stringify(layout)).toBe(original);
    expect(JSON.stringify(invalid.layout)).toBe(original);

    const nestedDrop = moveWidget(layout, "missing-widget", { columnId: layout.rows[0]!.columns[0]!.id, index: 0 });
    expect(nestedDrop.ok).toBe(false);
    expect(JSON.stringify(layout)).toBe(original);

    const headline = layout.rows[0]!.columns[0]!.children[0]!;
    const editor = layout.rows[0]!.columns[0]!.children[1]!;
    const removed = removeNode(layout, headline.id);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.focusId).toBe(editor.id);
    expect(removed.layout.rows[0]!.columns[0]!.children.map((widget) => widget.id)).toEqual([editor.id]);
  });

  it("duplicates a section with fresh descendant IDs and blocks shrinking occupied trailing columns", () => {
    const layout = fixture();
    const source = layout.rows[0]!;
    const before = new Set(orderedIds(layout));
    const duplicated = duplicateSection(layout, source.id);
    expect(duplicated.ok).toBe(true);
    if (!duplicated.ok) return;
    expect(duplicated.layout.rows).toHaveLength(3);
    const clone = duplicated.layout.rows[1]!;
    expect(clone.id).not.toBe(source.id);
    const cloneIds = orderedIds({ schema_version: 1, rows: [clone] });
    expect(cloneIds.some((id) => before.has(id))).toBe(false);
    expect(clone.columns[0]!.children[0]!.type).toBe(source.columns[0]!.children[0]!.type);

    const snapshot = JSON.stringify(layout);
    const blocked = resizeColumns(layout, source.id, [100]);
    expect(blocked.ok).toBe(false);
    expect(blocked.announcement).toMatch(/Clear Column 2/i);
    expect(JSON.stringify(layout)).toBe(snapshot);

    const cleared = structuredClone(layout);
    cleared.rows[0]!.columns[1]!.children = [];
    const resized = resizeColumns(cleared, cleared.rows[0]!.id, [100]);
    expect(resized.ok).toBe(true);
    if (!resized.ok) return;
    expect(resized.layout.rows[0]!.ratios).toEqual([100]);
    expect(resized.layout.rows[0]!.columns).toHaveLength(1);
  });

  it("shifts siblings with keyboard controls without changing other columns", () => {
    const layout = newRow();
    layout.ratios = [50, 50];
    layout.columns = [
      { id: "col-a", type: "column", children: [newWidget("headline"), newWidget("editor")] },
      { id: "col-b", type: "column", children: [newWidget("button")] },
    ];
    const document: VisualLayout = { schema_version: 1, rows: [layout] };
    const first = layout.columns[0]!.children[0]!.id;
    const second = layout.columns[0]!.children[1]!.id;
    const other = layout.columns[1]!.children[0]!.id;
    const moved = shiftWidget(document, first, 1);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.layout.rows[0]!.columns[0]!.children.map((widget) => widget.id)).toEqual([second, first]);
    expect(moved.layout.rows[0]!.columns[1]!.children.map((widget) => widget.id)).toEqual([other]);
  });
});
