"use client";

/**
 * Local navigation for one Site.
 *
 * Every request uses the Site id prop. Central menus are listed so their
 * ownership is visible, and this screen does not send edits for them.
 * Inherited menus stay on the parent Site; this screen only explains the
 * delivery policy returned for the selected Site.
 */
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useAsync, useToast } from "@uog/ui";
import { ApiError } from "@uog/api-client";

import {
  createSiteMenu,
  loadMenuTargets,
  loadSiteNavigation,
  loadSiteMenu,
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

const PLACES: readonly MenuPlace[] = ["", "header", "footer", "sidebar", "primary", "secondary"];
const NO_TARGETS: MenuTargets = { pages: [], posts: [], pagesAvailable: true, postsAvailable: true };

function menuError(cause: unknown): string {
  if (cause instanceof ApiError && cause.details && typeof cause.details === "object") {
    const fields = (cause.details as {fields?: unknown}).fields;
    if (fields && typeof fields === "object") {
      const messages = Object.entries(fields).flatMap(([field, value]) =>
        (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === "string").map(item => `${field}: ${item}`));
      if (messages.length) return messages.join(" ");
    }
  }
  return cause instanceof Error ? cause.message : "The menu could not be saved.";
}

function placeLabel(location: string): string {
  if (!location) return "Unassigned";
  if (location === "header") return "Header";
  if (location === "footer") return "Footer";
  return location;
}

function ownershipText(menu: MenuRecord): string {
  if (menu.is_global) {
    return "Central. The platform owns this menu. A Site administrator can see it here and cannot change it.";
  }
  return "Local. This Site owns this menu. Navigation assignments are optional; unassigned menus can be reused in sidebars.";
}

/**
 * The inheritance endpoint returns an array of policy objects. A missing
 * field or a non-array is no policy. Entries that are not objects are
 * ignored so one malformed row cannot crash the Site screen.
 */
function inheritancePolicies(data: { inheritance?: unknown }): MenuInheritanceRecord[] {
  if (!Array.isArray(data.inheritance)) return [];
  return data.inheritance.filter((entry): entry is MenuInheritanceRecord => {
    if (entry == null || typeof entry !== "object") return false;
    const row = entry as Partial<MenuInheritanceRecord>;
    return typeof row.id === "string" && typeof row.location === "string";
  });
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
  const [editingTag, setEditingTag] = useState(state.etag);
  const [name, setName] = useState(menu.name);
  const [location, setLocation] = useState<MenuPlace>(PLACES.includes(menu.location as MenuPlace) ? menu.location as MenuPlace : "");
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (location && location !== menu.location && taken.has(location)) {
      toast.error("That location already has a local menu for this Site.");
      return;
    }
    setBusy(true);
    try {
      unwrap(await updateSiteMenu(siteId, menu.id, editingTag, { name: name.trim(), location }));
      setEditing(false);
      onChanged();
    } catch (cause) {
      toast.error(menuError(cause));
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
        <Typography variant="caption">Identifier: {menu.code ?? menu.id}</Typography>
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
                toast.error(menuError(cause));
              })
              .finally(() => setBusy(false));
          }}
        >
          {menu.is_active ? `Retire ${menu.name}` : `Publish ${menu.name}`}
        </Button>
      ) : null}
      {canWrite ? (
        <Button variant="outlined" disabled={!structural || busy} onClick={() => { if (!editing) { setName(menu.name); setLocation(menu.location as MenuPlace); setEditingTag(state.etag); } setEditing(current => !current); }}>
          {editing ? `Close ${menu.name}` : `Edit ${menu.name}`}
        </Button>
      ) : null}
      {editing ? (
        <Box
          component="form"
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "repeat(2, minmax(0, 1fr))" },
            gap: 2,
            alignItems: "start",
            "& .MuiFormControl-root": { minWidth: 0, width: "100%" },
          }}
          onSubmit={save}
        >
          <TextField size="small" label="Local menu name" value={name} disabled={!structural || busy} onChange={(event) => setName(event.target.value)} required />
          <TextField
            select
            size="small"
            label="Assigned location"
            value={location}
            disabled={!structural || busy}
            onChange={(event) => setLocation(event.target.value as MenuPlace)}
            slotProps={{ select: { native: true } }}
          >
            {PLACES.map((place) => (
              <option key={place} value={place} disabled={Boolean(place) && place !== menu.location && taken.has(place)}>
                {placeLabel(place)}
              </option>
            ))}
          </TextField>
          <Button type="submit" variant="contained" disabled={!structural || busy || !name.trim()} sx={{ justifySelf: "start" }}>Save menu</Button>
        </Box>
      ) : null}
      {menu.is_active && canWrite && !canPublish ? (
        <Typography variant="body2" color="text.secondary">
          This menu is active. Changing it also needs menu publish permission.
        </Typography>
      ) : null}
      <MenuItemTree
        siteId={siteId}
        state={state}
        targets={targets}
        enabled={structural}
        onChanged={onChanged}
        showAvailability={false}
      />
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
    async () => unwrap(await loadSiteNavigation(siteId, false)),
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
  const menus = (navigation.data?.menus ?? []).filter(row => row.menu.site === siteId);
  const policies = navigation.data ? inheritancePolicies(navigation.data) : [];
  const taken = new Set(menus.filter((row) => !row.menu.is_global).map((row) => row.menu.location));
  const openPlaces = PLACES.filter((place) => !place || !taken.has(place));
  const [name, setName] = useState("");
  const [location, setLocation] = useState<MenuPlace>("");
  const [code, setCode] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => { setSelectedId(""); setSearch(""); setName(""); setCode(""); setLocation(""); }, [siteId]);
  const [busy, setBusy] = useState(false);
  const selectedLocation = openPlaces.includes(location) ? location : "";
  const matches = menus.filter(row => `${row.menu.name} ${row.menu.code ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const selected = matches.some(row => row.menu.id === selectedId) ? selectedId : (matches.find(row => !row.menu.is_global)?.menu.id ?? matches[0]?.menu.id);
  const selectedRecord = menus.find(row => row.menu.id === selected);
  const selectedTree = useAsync(async () => {
    if (!selectedRecord || selectedRecord.itemsLoaded !== false) return selectedRecord ?? null;
    return unwrap(await loadSiteMenu(siteId, selectedRecord.menu.id));
  }, [siteId, selected, navigation.data]);

  return (
    <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 3 }}>
      <Box sx={{ px: { xs: 2, sm: 3 }, py: 2, display: "flex", flexDirection: "column", gap: 2 }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Navigation</Typography>
          <Typography variant="body2" color="text.secondary">
            Menus for Site {siteId}. Create multiple named menus, choose one to manage its items, and optionally assign a navigation location.
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
        {targetState.data && !targetState.data.pagesAvailable ? (
          <Alert severity="info">Pages are not available for this Site. Page targets stay blocked.</Alert>
        ) : null}
        {targetState.data && !targetState.data.postsAvailable ? (
          <Alert severity="info">Posts are not available for this Site. Post targets stay blocked.</Alert>
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
              {policies.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  This Site has no inheritance policy. Public navigation uses its own active local menus and does not add a central fragment unless a delivery policy says so.
                </Typography>
              ) : (
                <Box component="ul" aria-label="Inherited menu policy" sx={{ m: 0, pl: 2 }}>
                  {policies.map((policy) => (
                    <Typography component="li" variant="body2" color="text.secondary" key={policy.id}>
                      {inheritanceText(policy)}
                    </Typography>
                  ))}
                </Box>
              )}
            </Box>
            <TextField size="small" label="Search menu directory" value={search} onChange={event => setSearch(event.target.value)} />
            <Box role="group" aria-label="Select a menu" sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              {matches.map(row => <Button key={row.menu.id} aria-pressed={selected === row.menu.id} onClick={() => setSelectedId(row.menu.id)} sx={{ maxWidth: "100%", overflowWrap: "anywhere", textAlign: "left" }}>{row.menu.name} / {row.menu.code ?? row.menu.id} / {row.menu.is_active ? "Published" : "Draft / retired"}</Button>)}
            </Box>
            {menus.length > 0 && !menus.some(row => `${row.menu.name} ${row.menu.code ?? ""}`.toLowerCase().includes(search.toLowerCase())) ? <Typography>No menus match your search. Clear the search or create a new menu.</Typography> : null}
            {selectedRecord?.itemsLoaded === false && selectedTree.loading ? <Typography role="status">Loading selected menu...</Typography> : null}
            {selectedTree.error ? <Alert severity="error" action={<Button onClick={selectedTree.reload}>Retry</Button>}>{selectedTree.error.message}</Alert> : null}
            {menus.length === 0 ? (
              <Typography variant="body2" color="text.secondary">This Site has no menus yet.</Typography>
            ) : (
              <Box component="ul" aria-label="Menus for this Site" sx={{ listStyle: "none", m: 0, p: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                {menus.filter(state => state.menu.id === selected).map((state) => state.menu.is_global ? (
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
                    state={selectedTree.data?.menu.id === state.menu.id && selectedTree.data.menu.site === siteId ? selectedTree.data : state}
                    taken={taken}
                    canWrite={canWrite}
                    canPublish={canPublish}
                    moduleOn={moduleOn && !navigation.loading && (state.itemsLoaded !== false || selectedTree.data?.menu.id === state.menu.id)}
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
              <Box
                component="form"
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "repeat(2, minmax(0, 1fr))" },
                  gap: 2,
                  alignItems: "start",
                  "& .MuiFormControl-root": { minWidth: 0, width: "100%" },
                }}
                onSubmit={(event) => {
                event.preventDefault();
                setBusy(true);
                void (code.trim() ? createSiteMenu(siteId, selectedLocation, name, code.trim()) : createSiteMenu(siteId, selectedLocation, name))
                  .then((result) => {
                    const created = unwrap(result);
                    setSelectedId(created.id);
                    setName(""); setCode("");
                    navigation.reload();
                  })
                  .catch((cause: unknown) => {
                    toast.error(menuError(cause));
                  })
                  .finally(() => setBusy(false));
              }}>
                <TextField size="small" label="New menu name" value={name} disabled={!moduleOn || busy} onChange={(event) => setName(event.target.value)} required />
                <TextField size="small" label="Menu identifier (optional)" value={code} onChange={event => setCode(event.target.value)} disabled={!moduleOn || busy} helperText="Unique within this Site and immutable. Leave blank to generate it from the name." inputProps={{ maxLength: 64, pattern: "[a-z0-9]+(-[a-z0-9]+)*" }} />
                <TextField
                  select
                  size="small"
                  label="New menu location"
                  value={selectedLocation}
                  disabled={!moduleOn || busy}
                  onChange={(event) => setLocation(event.target.value as MenuPlace)}
                  slotProps={{ select: { native: true } }}
                >
                  {PLACES.map((place) => (
                    <option key={place} value={place} disabled={Boolean(place) && taken.has(place)}>
                      {placeLabel(place)}
                    </option>
                  ))}
                </TextField>
                <Button type="submit" variant="contained" disabled={!moduleOn || busy || !name.trim()} sx={{ justifySelf: "start" }}>Create menu</Button>
              </Box>
            ) : null}
          </>
        ) : null}
      </Box>
    </Paper>
  );
}
