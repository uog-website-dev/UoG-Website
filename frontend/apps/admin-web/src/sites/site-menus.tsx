"use client";

/**
 * Header and footer editor for one Site.
 *
 * Reordering uses Move up and Move down buttons so the control is available
 * from the keyboard. The Site id is a prop; the panel never asks for another
 * Site and never sends that id in a body.
 */
import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useAsync, useToast } from "@uog/ui";

import {
  createMenuLink,
  createSiteMenu,
  loadSiteNavigation,
  reorderSiteMenu,
  setMenuActive,
} from "@/app/sites/menu-actions";
import type { MenuItemRecord, MenuLocationState } from "@/app/sites/menu-actions";
import { unwrap } from "@/organizations/contract";

const PATH = /^\/(?:[a-z0-9][a-z0-9-]{0,63}(?:\/[a-z0-9][a-z0-9-]{0,63})*)?$/;

function siblings(items: MenuItemRecord[], parent: string | null): MenuItemRecord[] {
  return items
    .filter((item) => item.parent === parent)
    .slice()
    .sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id));
}

function LocationEditor({
  siteId,
  title,
  location,
  state,
  enabled,
  onChanged,
}: {
  siteId: number;
  title: string;
  location: "header" | "footer";
  state: MenuLocationState | null;
  enabled: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [label, setLabel] = useState("");
  const [target, setTarget] = useState("/about");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      onChanged();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "The menu could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function move(item: MenuItemRecord, direction: -1 | 1) {
    if (!state) return;
    const group = siblings(state.items, item.parent);
    const index = group.findIndex((row) => row.id === item.id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= group.length) return;
    const order = group.map((row) => row.id);
    const [moved] = order.splice(index, 1);
    order.splice(next, 0, moved!);
    await run(async () => {
      unwrap(await reorderSiteMenu(siteId, state.menu.id, state.etag, item.parent, order));
    });
  }

  const roots = state ? siblings(state.items, null) : [];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{title}</Typography>
        {state ? (
          <Chip size="small" label={state.menu.is_active ? "Active" : "Inactive"} variant="outlined" />
        ) : (
          <Chip size="small" label="Not created" variant="outlined" />
        )}
      </Box>
      {!state ? (
        <Button
          variant="outlined"
          disabled={!enabled || busy}
          onClick={() => run(async () => {
            unwrap(await createSiteMenu(siteId, location));
          })}
        >
          Create {title.toLowerCase()} menu
        </Button>
      ) : (
        <>
          <Button
            variant="outlined"
            disabled={!enabled || busy}
            onClick={() => run(async () => {
              unwrap(await setMenuActive(siteId, state.menu.id, state.etag, !state.menu.is_active));
            })}
          >
            {state.menu.is_active ? `Unpublish ${title.toLowerCase()}` : `Publish ${title.toLowerCase()}`}
          </Button>
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "flex", flexDirection: "column", gap: 1 }}>
            {roots.map((item, index) => (
              <Box component="li" key={item.id} sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
                <Typography sx={{ minWidth: 120 }}>{item.label}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontFamily: "monospace" }}>{item.target}</Typography>
                <Button
                  size="small"
                  aria-label={`Move ${item.label} up`}
                  disabled={!enabled || busy || index === 0}
                  onClick={() => move(item, -1)}
                >
                  Move up
                </Button>
                <Button
                  size="small"
                  aria-label={`Move ${item.label} down`}
                  disabled={!enabled || busy || index === roots.length - 1}
                  onClick={() => move(item, 1)}
                >
                  Move down
                </Button>
              </Box>
            ))}
          </Box>
          <Box component="form" sx={{ display: "flex", gap: 1, flexWrap: "wrap" }} onSubmit={(event) => {
            event.preventDefault();
            if (!PATH.test(target)) {
              toast.error("Use a same-site path such as /about.");
              return;
            }
            void run(async () => {
              unwrap(await createMenuLink(siteId, state.menu.id, state.etag, { label: label.trim(), target }));
              setLabel("");
            });
          }}>
            <TextField size="small" label={`${title} label`} value={label} disabled={!enabled || busy} onChange={(event) => setLabel(event.target.value)} required />
            <TextField size="small" label="Path" value={target} disabled={!enabled || busy} onChange={(event) => setTarget(event.target.value)} required />
            <Button type="submit" variant="contained" disabled={!enabled || busy || !label.trim()}>Add link</Button>
          </Box>
        </>
      )}
    </Box>
  );
}

export function SiteMenusPanel({
  siteId,
  menusEnabled,
}: {
  siteId: number;
  menusEnabled: boolean | null;
}) {
  const navigation = useAsync(
    async () => unwrap(await loadSiteNavigation(siteId)),
    [siteId],
  );

  return (
    <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 3 }}>
      <Box sx={{ px: { xs: 2, sm: 3 }, py: 2, display: "flex", flexDirection: "column", gap: 2 }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Navigation</Typography>
          <Typography variant="body2" color="text.secondary">
            Header and footer for this Site only. Publishing makes the active menu available on the public website.
          </Typography>
        </Box>
        {menusEnabled === null ? (
          <Typography variant="body2" color="text.secondary">Checking the MENUS module…</Typography>
        ) : null}
        {menusEnabled === false ? (
          <Alert severity="warning">
            The MENUS module is off for this Site. Existing menus stay in place, changes are blocked, and the public website does not serve navigation.
          </Alert>
        ) : null}
        {navigation.loading ? (
          <Typography variant="body2" color="text.secondary">Loading menus…</Typography>
        ) : navigation.error ? (
          <Alert severity="error">{navigation.error.message}</Alert>
        ) : navigation.data ? (
          <>
            <LocationEditor
              siteId={siteId}
              title="Header"
              location="header"
              state={navigation.data.header}
              enabled={menusEnabled === true}
              onChanged={navigation.reload}
            />
            <LocationEditor
              siteId={siteId}
              title="Footer"
              location="footer"
              state={navigation.data.footer}
              enabled={menusEnabled === true}
              onChanged={navigation.reload}
            />
          </>
        ) : null}
      </Box>
    </Paper>
  );
}
