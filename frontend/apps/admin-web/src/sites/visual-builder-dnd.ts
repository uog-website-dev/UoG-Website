/** HTML5 drag helpers for Visual Builder composition. */
export const VISUAL_DND_MIME = "application/x-uog-visual-dnd";

export type VisualDragPayload = `row:${string}` | `widget:${string}` | `palette:${string}`;

export function isVisualDragPayload(value: string | null | undefined): value is VisualDragPayload {
  return typeof value === "string" && (
    value.startsWith("row:") || value.startsWith("widget:") || value.startsWith("palette:")
  );
}

export function isPalettePayload(value: VisualDragPayload | null | undefined): value is `palette:${string}` {
  return typeof value === "string" && value.startsWith("palette:");
}

export function paletteTypeFromPayload(payload: VisualDragPayload): string | null {
  return payload.startsWith("palette:") ? payload.slice(8) : null;
}

/** Start a move/copy drag. Custom + text/plain keeps Firefox and Chromium working. */
export function beginVisualDrag(
  event: { dataTransfer: DataTransfer | null; stopPropagation: () => void },
  payload: VisualDragPayload,
) {
  event.stopPropagation();
  const transfer = event.dataTransfer;
  if (!transfer) return;
  transfer.effectAllowed = payload.startsWith("palette:") ? "copy" : "move";
  transfer.setData(VISUAL_DND_MIME, payload);
  transfer.setData("text/plain", payload);
}

export function readVisualDrag(
  event: { dataTransfer: DataTransfer | null },
  fallback: string | null = null,
): VisualDragPayload | null {
  const transfer = event.dataTransfer;
  const raw = transfer?.getData(VISUAL_DND_MIME) || transfer?.getData("text/plain") || fallback;
  return isVisualDragPayload(raw) ? raw : null;
}

export function allowVisualDrop(
  event: {
    preventDefault: () => void;
    stopPropagation: () => void;
    dataTransfer: DataTransfer | null;
  },
  active: VisualDragPayload | null = null,
) {
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = active?.startsWith("palette:") ? "copy" : "move";
  }
}
