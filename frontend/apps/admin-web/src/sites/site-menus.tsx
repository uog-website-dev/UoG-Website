"use client";

/**
 * Local navigation for one Site.
 *
 * Every request uses the Site id prop. Central menus are listed so their
 * ownership is visible, and this screen does not send edits for them.
 * Inherited menus stay on the parent Site; this screen only explains the
 * delivery policy returned for the selected Site.
 */
import { useState } from "react";
import type { FormEvent } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useAsync, useToast } from "@uog/ui";

import {
  createSiteMenu,
  loadMenuTargets,
  loadSiteNavigation,
  setMenuActive,
  updateSiteMenu,
} from "@/app/sites/menu-actions";
import type {
  MenuInheritanceRecord,
  MenuLocationState,
  MenuPlace,
  MenuRecord,
  MenuTargets,
} from "@/app/sites/menu-actions";
import { MenuItemTree } from "@/sites/menu-items";
import { unwrap } from "@/organizations/contract";

const PLACES: readonly MenuPlace[] = ["header", "footer"];
const NO_TARGETS: MenuTargets = { pages: [], posts: [], pagesAvailable: true, postsAvailable: true };

function placeLabel(location: string): string {
  if (location === "header") return "Header";
  if (location === "footer") return "Footer";
  return location;
}

function ownershipText(menu: MenuRecord): string {
  if (menu.is_global) {
    return "Central. The platform owns this menu. A Site administrator can see it here and cannot change it.";
  }
  return "Local. This Site owns this menu. Header and footer are assigned here.";
}

function inheritanceText(policy: MenuInheritanceRecord): string {
  const parent = policy.inherit_from == null
    ? "It does not copy another Site's menu."
    : `It copies Site ${policy.inherit_from}'s own local menu. That menu is edited on the owning Site, not here.`;
  const central = policy.include_global
    ? "Public delivery includes the central fragment."
    : "Public delivery does not include the central fragment.";
  const order = policy.local_precedence === "append"
    ? "This Site's local links are appended."
    : "This Site's local menu replaces the inherited links.";
  return `${placeLabel(policy.location)}: ${central} ${parent} ${order}`;
}

function LocalMenuEditor({
  targets,
  siteId,
  state,
  taken,
  canWrite,
  canPublish,
  moduleOn,
  onChanged,
}: {
  siteId: number;
  state: MenuLocationState;
  taken: ReadonlySet<string>;
  canWrite: boolean;
  canPublish: boolean;
  moduleOn: boolean;
  targets: MenuTargets;
  onChanged: () => void;
}) {
  const toast = useToast();
  const menu = state.menu;
  const structural = moduleOn && canWrite && (!menu.is_active || canPublish);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(menu.name);
  const [location, setLocation] = useState<MenuPlace>(menu.location === "footer" ? "footer" : "header");
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (location !== menu.location && taken.has(location)) {
      toast.error("That location already has a local menu for this Site.");
      return;
    }
    setBusy(true);
    try {
      unwrap(await updateSiteMenu(siteId, menu.id, state.etag, { name: name.trim(), location }));
      setEditing(false);
      onChanged();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "The menu could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box component="li" sx={{ display: "flex", flexDirection: "column", gap: 1.5, py: 1 }}>
      <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{menu.name}</Typography>
        <Chip size="small" label={placeLabel(menu.location)} variant="outlined" />
        <Chip size="small" label={menu.is_active ? "Active" : "Inactive"} variant="outlined" />
        <Chip size="small" label="Local" variant="outlined" />
      </Box>
      <Typography variant="body2" color="text.secondary">{ownershipText(menu)}</Typography>
      {canPublish ? (
        <Button
          variant="outlined"
          disabled={!moduleOn || busy}
          onClick={() => {
            setBusy(true);
            void setMenuActive(siteId, menu.id, state.etag, !menu.is_active)
              .then((result) => {
                unwrap(result);
                onChanged();
              })
              .catch((cause: unknown) => {
                toast.error(cause instanceof Error ? cause.message : "The menu could not be saved.");
              })
              .finally(() => setBusy(false));
          }}
        >
          {menu.is_active ? `Unpublish ${menu.name}` : `Publish ${menu.name}`}
        </Button>
      ) : null}
      {canWrite ? (
        <Button variant="outlined" disabled={!structural || busy} onClick={() => setEditing((current) => !current)}>
          {editing ? `Close ${menu.name}` : `Edit ${menu.name}`}
        </Button>
      ) : null}
      {editing ? (
        <Box component="form" sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }} onSubmit={save}>
          <TextField size="small" label="Local menu name" value={name} disabled={!structural || busy} onChange={(event) => setName(event.target.value)} required />
          <TextField
            select
            size="small"
            label="Assigned location"
            value={location}
            disabled={!structural || busy}
            onChange={(event) => setLocation(event.target.value === "footer" ? "footer" : "header")}
            slotProps={{ select: { native: true } }}
          >
            {PLACES.map((place) => (
              <option key={place} value={place} disabled={place !== menu.location && taken.has(place)}>
                {placeLabel(place)}
              </option>
            ))}
          </TextField>
          <Button type="submit" variant="contained" disabled={!structural || busy || !name.trim()}>Save menu</Button>
        </Box>
      ) : null}
      {menu.is_active && canWrite && !canPublish ? (
        <Typography variant="body2" color="text.secondary">
          This menu is active. Changing it also needs menu publish permission.
        </Typography>
      ) : null}
      <MenuItemTree siteId={siteId} state={state} targets={targets} enabled={structural} onChanged={onChanged} />
    </Box>
  );
}

export function SiteMenusPanel({
  siteId,
  menusEnabled,
  permissions,
}: {
  siteId: number;
  menusEnabled: boolean | null;
  permissions: readonly string[];
}) {
  const toast = useToast();
  const navigation = useAsync(
    async () => unwrap(await loadSiteNavigation(siteId)),
    [siteId],
  );
  const targetState = useAsync(
    async () => unwrap(await loadMenuTargets(siteId)),
    [siteId],
  );
  const targets = targetState.data ?? NO_TARGETS;
  const canWrite = permissions.includes("menu.write");
  const canPublish = permissions.includes("menu.publish");
  const moduleOn = menusEnabled === true;
  const menus = navigation.data?.menus ?? [];
  const taken = new Set(menus.filter((row) => !row.menu.is_global).map((row) => row.menu.location));
  const openPlaces = PLACES.filter((place) => !taken.has(place));
  const [name, setName] = useState("");
  const [location, setLocation] = useState<MenuPlace>("header");
  const [busy, setBusy] = useState(false);
  const selectedLocation = openPlaces.includes(location) ? location : (openPlaces[0] ?? "header");

  return (
    <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 3 }}>
      <Box sx={{ px: { xs: 2, sm: 3 }, py: 2, display: "flex", flexDirection: "column", gap: 2 }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Navigation</Typography>
          <Typography variant="body2" color="text.secondary">
            Menus for Site {siteId}. A local menu is created and edited here and assigned to the header or footer.
            A central menu belongs to the platform. An inherited menu stays on its owning Site; this Site only records whether public delivery should include it.
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
        {!canWrite && !canPublish ? (
          <Alert severity="info">
            You can view menus for this Site. Creating or editing a local menu needs menu write permission. Publishing needs menu publish permission.
          </Alert>
        ) : null}
        {navigation.loading && !navigation.data ? (
          <Typography variant="body2" color="text.secondary">Loading menus…</Typography>
        ) : null}
        {navigation.error ? (
          <Alert severity="error">{navigation.error.message}</Alert>
        ) : null}
        {navigation.data ? (
          <>
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Ownership</Typography>
              {navigation.data.inheritance.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  This Site has no inheritance policy. Public navigation uses its own active local menus and does not add a central fragment unless a delivery policy says so.
                </Typography>
              ) : (
                <Box component="ul" aria-label="Inherited menu policy" sx={{ m: 0, pl: 2 }}>
                  {navigation.data.inheritance.map((policy) => (
                    <Typography component="li" variant="body2" color="text.secondary" key={policy.id}>
                      {inheritanceText(policy)}
                    </Typography>
                  ))}
                </Box>
              )}
            </Box>
            {menus.length === 0 ? (
              <Typography variant="body2" color="text.secondary">This Site has no menus yet.</Typography>
            ) : (
              <Box component="ul" aria-label="Menus for this Site" sx={{ listStyle: "none", m: 0, p: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                {menus.map((state) => state.menu.is_global ? (
                  <Box component="li" key={state.menu.id} sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                    <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{state.menu.name}</Typography>
                      <Chip size="small" label={placeLabel(state.menu.location)} variant="outlined" />
                      <Chip size="small" label={state.menu.is_active ? "Active" : "Inactive"} variant="outlined" />
                      <Chip size="small" label="Central" variant="outlined" />
                    </Box>
                    <Typography variant="body2" color="text.secondary">{ownershipText(state.menu)}</Typography>
                  </Box>
                ) : (
                  <LocalMenuEditor
                    key={state.menu.id}
                    siteId={siteId}
                    state={state}
                    taken={taken}
                    canWrite={canWrite}
                    canPublish={canPublish}
                    moduleOn={moduleOn}
                    targets={targets}
                    onChanged={navigation.reload}
                  />
                ))}
              </Box>
            )}
            {canWrite && openPlaces.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Header and footer already have a local menu for this Site.
              </Typography>
            ) : null}
            {canWrite && openPlaces.length > 0 ? (
              <Box component="form" sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }} onSubmit={(event) => {
                event.preventDefault();
                setBusy(true);
                void createSiteMenu(siteId, selectedLocation, name)
                  .then((result) => {
                    unwrap(result);
                    setName("");
                    navigation.reload();
                  })
                  .catch((cause: unknown) => {
                    toast.error(cause instanceof Error ? cause.message : "The menu could not be saved.");
                  })
                  .finally(() => setBusy(false));
              }}>
                <TextField size="small" label="New menu name" value={name} disabled={!moduleOn || busy} onChange={(event) => setName(event.target.value)} required />
                <TextField
                  select
                  size="small"
                  label="New menu location"
                  value={selectedLocation}
                  disabled={!moduleOn || busy}
                  onChange={(event) => setLocation(event.target.value === "footer" ? "footer" : "header")}
                  slotProps={{ select: { native: true } }}
                >
                  {PLACES.map((place) => (
                    <option key={place} value={place} disabled={taken.has(place)}>
                      {placeLabel(place)}
                    </option>
                  ))}
                </TextField>
                <Button type="submit" variant="contained" disabled={!moduleOn || busy || !name.trim()}>Create menu</Button>
              </Box>
            ) : null}
          </>
        ) : null}
      </Box>
    </Paper>
  );
}
