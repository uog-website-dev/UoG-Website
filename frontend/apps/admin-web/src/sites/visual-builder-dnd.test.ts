import { describe, expect, it, vi } from "vitest";
import {
  allowVisualDrop,
  beginVisualDrag,
  isPalettePayload,
  isVisualDragPayload,
  paletteTypeFromPayload,
  readVisualDrag,
  VISUAL_DND_MIME,
} from "./visual-builder-dnd";

function transfer() {
  const data = new Map<string, string>();
  return {
    effectAllowed: "none",
    dropEffect: "none",
    setData: (type: string, value: string) => { data.set(type, value); },
    getData: (type: string) => data.get(type) ?? "",
  };
}

describe("visual builder drag helpers", () => {
  it("writes custom and text payloads so Firefox and Chromium can drop", () => {
    const dataTransfer = transfer();
    const stopPropagation = vi.fn();
    beginVisualDrag({ dataTransfer: dataTransfer as unknown as DataTransfer, stopPropagation }, "widget:abc");
    expect(stopPropagation).toHaveBeenCalled();
    expect(dataTransfer.effectAllowed).toBe("move");
    expect(dataTransfer.getData(VISUAL_DND_MIME)).toBe("widget:abc");
    expect(dataTransfer.getData("text/plain")).toBe("widget:abc");
    expect(isVisualDragPayload("row:1")).toBe(true);
    expect(isVisualDragPayload("column:1")).toBe(false);
  });

  it("marks palette drags as copy inserts", () => {
    const dataTransfer = transfer();
    beginVisualDrag(
      { dataTransfer: dataTransfer as unknown as DataTransfer, stopPropagation: vi.fn() },
      "palette:headline",
    );
    expect(dataTransfer.effectAllowed).toBe("copy");
    expect(isVisualDragPayload("palette:headline")).toBe(true);
    expect(isPalettePayload("palette:headline")).toBe(true);
    expect(paletteTypeFromPayload("palette:headline")).toBe("headline");
    expect(paletteTypeFromPayload("widget:abc")).toBeNull();
  });

  it("reads transfer data and falls back to the active drag ref", () => {
    const dataTransfer = transfer();
    dataTransfer.setData(VISUAL_DND_MIME, "row:home");
    expect(readVisualDrag({ dataTransfer: dataTransfer as unknown as DataTransfer })).toBe("row:home");
    expect(readVisualDrag({ dataTransfer: transfer() as unknown as DataTransfer }, "widget:fallback")).toBe("widget:fallback");
    expect(readVisualDrag({ dataTransfer: transfer() as unknown as DataTransfer }, "palette:button")).toBe("palette:button");
    expect(readVisualDrag({ dataTransfer: transfer() as unknown as DataTransfer })).toBeNull();
  });

  it("marks drop targets as move or copy destinations", () => {
    const dataTransfer = transfer();
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    allowVisualDrop({ preventDefault, stopPropagation, dataTransfer: dataTransfer as unknown as DataTransfer });
    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    expect(dataTransfer.dropEffect).toBe("move");

    allowVisualDrop(
      { preventDefault, stopPropagation, dataTransfer: dataTransfer as unknown as DataTransfer },
      "palette:image",
    );
    expect(dataTransfer.dropEffect).toBe("copy");
  });
});
