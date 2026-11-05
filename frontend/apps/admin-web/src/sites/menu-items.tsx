"use client";

/**
 * Menu item tree for one Site menu.
 *
 * Move up, move down, nest and move out are buttons, so a keyboard can
 * reorder and indent without a pointer. Dropping an item on a sibling
 * reorders that group. The current Menu ETag is sent with every save.
 * A conflict reloads the tree and does not retry the stale write.
 */
import { useRef, useState } from "react";
import type { DragEvent, FormEvent } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useToast } from "@uog/ui";

import {
  createMenuLink,
  deleteMenuItem,
  moveMenuItem,
  reorderSiteMenu,
  updateMenuItem,
} from "@/app/sites/menu-actions";
import type {
  MenuItemInput,
  MenuItemKind,
  MenuItemRecord,
  MenuLocationState,
  MenuTargets,
} from "@/app/sites/menu-actions";
import type { ActionResult } from "@/organizations/contract";

const MAX_MENU_DEPTH = 4;

const PATH = /^\/(?:[a-z0-9][a-z0-9-]{0,63}(?:\/[a-z0-9][a-z0-9-]{0,63})*)?$/;

const EMPTY_TARGETS: MenuTargets = {
  pages: [],
  posts: [],
  pagesAvailable: true,
  postsAvailable: true,
};

function siblings(items: MenuItemRecord[], parent: string | null): MenuItemRecord[] {
  return items
    .filter((item) => item.parent === parent)
    .slice()
    .sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id));
}

function depthOf(items: MenuItemRecord[], id: string | null): number {
  let depth = 0;
  let current = id;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current)) return MAX_MENU_DEPTH + 1;
    seen.add(current);
    depth += 1;
    current = items.find((item) => item.id === current)?.parent ?? null;
  }
  return depth;
}

function subtreeHeight(items: MenuItemRecord[], id: string): number {
  const children = items.filter((item) => item.parent === id);
  if (children.length === 0) return 1;
  return 1 + Math.max(...children.map((child) => subtreeHeight(items, child.id)));
}

/** Same limit as the menu service: parent depth plus the moved subtree. */
function canPlace(items: MenuItemRecord[], itemId: string, parentId: string | null): boolean {
  return depthOf(items, parentId) + subtreeHeight(items, itemId) <= MAX_MENU_DEPTH;
}

function isInside(items: MenuItemRecord[], ancestorId: string, nodeId: string): boolean {
  let current: string | null = nodeId;
  const seen = new Set<string>();
  while (current) {
    if (current === ancestorId) return true;
    if (seen.has(current)) return true;
    seen.add(current);
    current = items.find((item) => item.id === current)?.parent ?? null;
  }
  return false;
}

function externalUrlError(value: string): string | null {
  const href = value.trim();
  if (!href || /[\u0000-\u0020\u007f\\]/.test(href)) return "Use an http or https URL.";
  if (href.startsWith("//")) return "Protocol-relative URLs are not allowed.";
  if (/%(?:0[0-9a-f]|1[0-9a-f]|7f|5c|25)/i.test(href) || /%(?![0-9a-f]{2})/i.test(href)) {
    return "Encoded controls are not allowed in an external URL.";
  }
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return "Use an http or https URL.";
  }
  if (url.username || url.password || href.slice(href.indexOf("//") + 2).includes("@")) {
    return "External URLs cannot embed credentials.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "External URLs must use http or https.";
  return null;
}

function targetText(item: MenuItemRecord, targets: MenuTargets): string {
  if (item.item_type === "page") {
    const page = targets.pages.find((row) => row.id === item.page);
    return page ? page.label : "Unavailable Page";
  }
  if (item.item_type === "post") {
    const post = targets.posts.find((row) => row.id === item.post);
    return post ? post.label : "Unavailable Post";
  }
  return item.target || "No target";
}

function targetError(kind: MenuItemKind, value: string, targets: MenuTargets): string | null {
  if (kind === "custom") {
    return PATH.test(value) ? null : "Use a same-site path such as /about.";
  }
  if (kind === "external") return externalUrlError(value);
  if (kind === "page") {
    if (!targets.pagesAvailable) return "Pages are not available for this Site.";
    return targets.pages.some((row) => row.id === value) ? null : "Choose a Page from this Site.";
  }
  if (!targets.postsAvailable) return "Posts are not available for this Site.";
  return targets.posts.some((row) => row.id === value) ? null : "Choose a Post from this Site.";
}

export function MenuItemTree({
  siteId,
  state,
  targets = EMPTY_TARGETS,
  enabled,
  onChanged,
  showAvailability = true,
}: {
  siteId: number;
  state: MenuLocationState;
  targets?: MenuTargets;
  enabled: boolean;
  onChanged: () => void;
  /** The menu editor shows this once. Nested trees must not repeat it. */
  showAvailability?: boolean;
}) {
  const toast = useToast();
  const dragId = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const items = state.items;

  async function commit<T>(result: ActionResult<T>, after?: () => void) {
    if (!result.ok) {
      if (result.error.status === 409) {
        setConflict("This menu was saved by someone else. The latest items were reloaded and your change was not applied.");
        onChanged();
        return;
      }
      toast.error(result.error.message);
      return;
    }
    setConflict(null);
    after?.();
    onChanged();
  }

  async function run<T>(action: () => Promise<ActionResult<T>>, after?: () => void) {
    setBusy(true);
    setNotice(null);
    try {
      await commit(await action(), after);
    } finally {
      setBusy(false);
    }
  }

  function reorder(parent: string | null, order: string[]) {
    return run(() => reorderSiteMenu(siteId, state.menu.id, state.etag, parent, order));
  }

  function move(itemId: string, parent: string | null, position: number) {
    return run(() => moveMenuItem(siteId, state.menu.id, itemId, state.etag, parent, position));
  }

  function shift(item: MenuItemRecord, direction: -1 | 1) {
    const group = siblings(items, item.parent);
    const index = group.findIndex((row) => row.id === item.id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= group.length) return;
    const order = group.map((row) => row.id);
    const [moved] = order.splice(index, 1);
    order.splice(next, 0, moved!);
    void reorder(item.parent, order);
  }

  function nest(item: MenuItemRecord) {
    const group = siblings(items, item.parent);
    const index = group.findIndex((row) => row.id === item.id);
    const parent = index > 0 ? group[index - 1] : undefined;
    if (!parent) return;
    if (!canPlace(items, item.id, parent.id)) {
      setNotice("Menu items cannot be nested deeper than 4 levels.");
      return;
    }
    void move(item.id, parent.id, siblings(items, parent.id).length);
  }

  function lift(item: MenuItemRecord) {
    if (!item.parent) return;
    const parent = items.find((row) => row.id === item.parent);
    const grand = parent?.parent ?? null;
    const index = siblings(items, grand).findIndex((row) => row.id === item.parent);
    void move(item.id, grand, index < 0 ? 0 : index + 1);
  }

  function dropOn(target: MenuItemRecord) {
    const sourceId = dragId.current;
    dragId.current = null;
    if (!enabled || !sourceId || sourceId === target.id) return;
    const source = items.find((row) => row.id === sourceId);
    if (!source) return;
    if (isInside(items, source.id, target.id)) {
      setNotice("A menu item cannot be moved under itself.");
      return;
    }
    if (source.parent === target.parent) {
      const order = siblings(items, source.parent).map((row) => row.id);
      const from = order.indexOf(source.id);
      const to = order.indexOf(target.id);
      order.splice(from, 1);
      order.splice(to, 0, source.id);
      void reorder(source.parent, order);
      return;
    }
    if (!canPlace(items, source.id, target.id)) {
      setNotice("Menu items cannot be nested deeper than 4 levels.");
      return;
    }
    void move(source.id, target.id, siblings(items, target.id).length);
  }

  function renderItems(parent: string | null, depth: number) {
    const group = siblings(items, parent);
    if (group.length === 0) return null;
    return (
      <Box
        component="ul"
        aria-label={parent ? undefined : "Menu items"}
        sx={{ listStyle: "none", m: 0, p: 0, display: "flex", flexDirection: "column", gap: 1 }}
      >
        {group.map((item, index) => {
          const child = items.some((row) => row.parent === item.id);
          return (
            <Box
              component="li"
              key={item.id}
              aria-label={item.label}
              draggable={enabled && !busy}
              onDragStart={(event: DragEvent) => {
                dragId.current = item.id;
                event.dataTransfer?.setData("text/plain", item.id);
              }}
              onDragOver={(event: DragEvent) => {
                if (enabled) event.preventDefault();
              }}
              onDrop={(event: DragEvent) => {
                event.preventDefault();
                dropOn(item);
              }}
              sx={{ display: "flex", flexDirection: "column", gap: 0.5, pl: depth * 2 }}
            >
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 1,
                  p: 1.5,
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 1,
                  bgcolor: "background.paper",
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{item.label}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                    {targetText(item, targets)}
                  </Typography>
                </Box>
                <Box
                  aria-label={`Actions for ${item.label}`}
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" },
                    gap: 1.5,
                  }}
                >
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary">Order</Typography>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      <Button size="small" aria-label={`Move ${item.label} up`} disabled={!enabled || busy || index === 0} onClick={() => shift(item, -1)}>Move up</Button>
                      <Button size="small" aria-label={`Move ${item.label} down`} disabled={!enabled || busy || index === group.length - 1} onClick={() => shift(item, 1)}>Move down</Button>
                    </Box>
                  </Box>
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary">Structure</Typography>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      <Button size="small" aria-label={`Nest ${item.label}`} disabled={!enabled || busy || index === 0} onClick={() => nest(item)}>Nest</Button>
                      <Button size="small" aria-label={`Move ${item.label} out`} disabled={!enabled || busy || !item.parent} onClick={() => lift(item)}>Move out</Button>
                    </Box>
                  </Box>
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary">Item</Typography>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      <Button size="small" aria-label={`Edit ${item.label}`} disabled={!enabled || busy} onClick={() => setEditingId(editingId === item.id ? null : item.id)}>Edit</Button>
                      <Button size="small" aria-label={`Remove ${item.label}`} disabled={!enabled || busy || child} onClick={() => void run(() => deleteMenuItem(siteId, state.menu.id, item.id, state.etag))}>Remove</Button>
                    </Box>
                  </Box>
                </Box>
              </Box>
              {child ? (
                <Typography variant="caption" color="text.secondary">Remove the nested items before removing {item.label}.</Typography>
              ) : null}
              {editingId === item.id ? (
                <ItemForm
                  legend={`Edit ${item.label}`}
                  submitLabel="Save item"
                  initial={item}
                  items={items}
                  targets={targets}
                  enabled={enabled && !busy}
                  onSubmit={(input) => void run(
                    () => updateMenuItem(siteId, state.menu.id, item.id, state.etag, input),
                    () => setEditingId(null),
                  )}
                />
              ) : null}
              {renderItems(item.id, depth + 1)}
            </Box>
          );
        })}
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {conflict ? <Alert severity="warning">{conflict}</Alert> : null}
      {notice ? <Alert severity="warning">{notice}</Alert> : null}
      {showAvailability && !targets.pagesAvailable ? (
        <Alert severity="info">Pages are not available for this Site. Page targets stay blocked.</Alert>
      ) : null}
      {showAvailability && !targets.postsAvailable ? (
        <Alert severity="info">Posts are not available for this Site. Post targets stay blocked.</Alert>
      ) : null}
      {items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">This menu has no items yet.</Typography>
      ) : renderItems(null, 0)}
      <ItemForm
        legend={`Add to ${state.menu.name}`}
        submitLabel="Add link"
        items={items}
        targets={targets}
        enabled={enabled && !busy}
        onSubmit={(input) => void run(() => createMenuLink(siteId, state.menu.id, state.etag, input))}
      />
    </Box>
  );
}

function ItemForm({
  legend,
  submitLabel,
  initial,
  items,
  targets,
  enabled,
  onSubmit,
}: {
  legend: string;
  submitLabel: string;
  initial?: MenuItemRecord;
  items: MenuItemRecord[];
  targets: MenuTargets;
  enabled: boolean;
  onSubmit: (input: MenuItemInput) => void;
}) {
  const initialKind: MenuItemKind = initial?.item_type === "page" || initial?.item_type === "post" || initial?.item_type === "external"
    ? initial.item_type
    : "custom";
  const [label, setLabel] = useState(initial?.label ?? "");
  const [kind, setKind] = useState<MenuItemKind>(initialKind);
  const [target, setTarget] = useState(initial?.target || (initialKind === "custom" ? "/about" : ""));
  const [page, setPage] = useState(initial?.page ?? "");
  const [post, setPost] = useState(initial?.post ?? "");
  const [parent, setParent] = useState(initial?.parent ?? "");
  const [warning, setWarning] = useState<string | null>(null);
  const value = kind === "page" ? page : kind === "post" ? post : target;
  const problem = targetError(kind, value, targets);
  const parents = items.filter((item) => (
    initial
      ? item.id !== initial.id && canPlace(items, initial.id, item.id)
      : depthOf(items, item.id) < MAX_MENU_DEPTH
  ));

  function submit(event: FormEvent) {
    event.preventDefault();
    const message = targetError(kind, value, targets);
    if (message) {
      setWarning(message);
      return;
    }
    if (initial && parent !== (initial.parent ?? "") && !canPlace(items, initial.id, parent || null)) {
      setWarning("Menu items cannot be nested deeper than 4 levels.");
      return;
    }
    setWarning(null);
    onSubmit({
      label: label.trim(),
      item_type: kind,
      target: kind === "custom" || kind === "external" ? target.trim() : "",
      page: kind === "page" ? page : null,
      post: kind === "post" ? post : null,
      parent: initial ? undefined : parent || null,
    });
    if (!initial) setLabel("");
  }

  const fieldNotice = problem === "Pages are not available for this Site." || problem === "Posts are not available for this Site."
    ? null
    : problem;

  return (
    <Box
      component="form"
      aria-label={legend}
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "repeat(2, minmax(0, 1fr))" },
        gap: 2,
        alignItems: "start",
        "& .MuiFormControl-root": { minWidth: 0, width: "100%" },
      }}
      onSubmit={submit}
    >
      <TextField size="small" label="Item label" value={label} disabled={!enabled} onChange={(event) => setLabel(event.target.value)} required />
      <TextField
        select
        size="small"
        label="Item target"
        value={kind}
        disabled={!enabled}
        onChange={(event) => setKind(event.target.value as MenuItemKind)}
        slotProps={{ select: { native: true } }}
      >
        <option value="custom">Same-site path</option>
        <option value="page" disabled={!targets.pagesAvailable}>Page</option>
        <option value="post" disabled={!targets.postsAvailable}>Post</option>
        <option value="external">External URL</option>
      </TextField>
      {kind === "page" ? (
        <TextField select size="small" label="Page" value={page} disabled={!enabled || !targets.pagesAvailable} onChange={(event) => setPage(event.target.value)} slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}>
          <option value="">Choose a Page</option>
          {targets.pages.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
        </TextField>
      ) : null}
      {kind === "post" ? (
        <TextField select size="small" label="Post" value={post} disabled={!enabled || !targets.postsAvailable} onChange={(event) => setPost(event.target.value)} slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}>
          <option value="">Choose a Post</option>
          {targets.posts.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
        </TextField>
      ) : null}
      {kind === "custom" ? (
        <TextField size="small" label="Path" value={target} disabled={!enabled} onChange={(event) => setTarget(event.target.value)} required />
      ) : null}
      {kind === "external" ? (
        <TextField size="small" label="External URL" value={target} disabled={!enabled} onChange={(event) => setTarget(event.target.value)} required />
      ) : null}
      {!initial ? (
        <TextField select size="small" label="Place under" value={parent} disabled={!enabled} onChange={(event) => setParent(event.target.value)} slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}>
          <option value="">Top level</option>
          {parents.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
        </TextField>
      ) : null}
      <Button type="submit" variant="contained" disabled={!enabled || !label.trim() || Boolean(problem)} sx={{ justifySelf: "start" }}>
        {submitLabel}
      </Button>
      {warning || fieldNotice ? (
        <Alert severity="warning" sx={{ gridColumn: "1 / -1" }}>{warning || fieldNotice}</Alert>
      ) : null}
    </Box>
  );
}
