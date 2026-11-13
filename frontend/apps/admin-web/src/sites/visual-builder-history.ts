import type { VisualLayout } from "@uog/types";

/** Maximum retained local undo steps (not CMS revisions). */
export const VISUAL_HISTORY_LIMIT = 50;

/** Consecutive inspector edits coalesce within this window into one undo step. */
export const VISUAL_HISTORY_COALESCE_MS = 500;

export interface VisualHistoryEntry {
  layout: VisualLayout;
  selected: string | null;
}

export function pushHistory(
  past: VisualHistoryEntry[],
  entry: VisualHistoryEntry,
  limit = VISUAL_HISTORY_LIMIT,
): VisualHistoryEntry[] {
  return [...past.slice(-(limit - 1)), entry];
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

export function historyShortcut(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "target">,
): "undo" | "redo" | null {
  if (event.altKey || !(event.ctrlKey || event.metaKey)) return null;
  if (isEditableKeyboardTarget(event.target)) return null;
  const key = event.key.toLowerCase();
  if (key === "z" && !event.shiftKey) return "undo";
  if (key === "y" || (key === "z" && event.shiftKey)) return "redo";
  return null;
}
