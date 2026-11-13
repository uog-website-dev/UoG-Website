/**
 * Sequential bulk lifecycle helpers. Hard deletes are forbidden for Sites and
 * Organizations; Domains also have no destroy path. Bulk "delete" therefore
 * means archive (Sites / inactive Orgs) or deactivate (Domains / active Orgs).
 */
import type { ActionResult } from "@/organizations/contract";

export interface BulkItemResult {
  id: string | number;
  label: string;
  ok: boolean;
  message?: string;
}

export interface BulkLifecycleSummary {
  attempted: number;
  succeeded: number;
  failed: BulkItemResult[];
}

export async function runBulkLifecycle<T extends { id: string | number }>(
  items: T[],
  options: {
    labelOf: (item: T) => string;
    apply: (item: T) => Promise<ActionResult<unknown>>;
  },
): Promise<BulkLifecycleSummary> {
  const failed: BulkItemResult[] = [];
  let succeeded = 0;
  for (const item of items) {
    const label = options.labelOf(item);
    const result = await options.apply(item);
    if (result.ok) {
      succeeded += 1;
    } else {
      failed.push({
        id: item.id,
        label,
        ok: false,
        message: result.error.message || "The change was refused.",
      });
    }
  }
  return { attempted: items.length, succeeded, failed };
}

export function summarizeBulkLifecycle(summary: BulkLifecycleSummary, noun: string): string {
  if (summary.attempted === 0) return `No ${noun} were selected.`;
  if (summary.failed.length === 0) {
    return `Deleted ${summary.succeeded} ${noun}${summary.succeeded === 1 ? "" : "s"}.`;
  }
  if (summary.succeeded === 0) {
    return `Could not delete any of the ${summary.attempted} selected ${noun}${summary.attempted === 1 ? "" : "s"}.`;
  }
  return `Deleted ${summary.succeeded} of ${summary.attempted} ${noun}${summary.attempted === 1 ? "" : "s"}. ${summary.failed.length} failed.`;
}
