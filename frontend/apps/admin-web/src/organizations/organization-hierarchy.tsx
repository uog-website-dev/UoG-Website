"use client";

import AccountTreeRoundedIcon from "@mui/icons-material/AccountTreeRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type {
  Organization,
  OrganizationHierarchy as OrganizationHierarchyData,
} from "@uog/types";
import { ApiError } from "@uog/api-client";
import { ApiErrorState } from "@uog/ui";

import {
  getOrganizationTree,
  moveOrganization,
} from "@/app/organizations/actions";
import { deserializeApiError } from "@/organizations/contract";
import type { ApiErrorPayload } from "@/organizations/contract";
import {
  buildOrganizationTreeRows,
  countOrganizationDescendants,
  getOrganizationAncestors,
} from "@/organizations/hierarchy-tree";
import { organizationTypeLabel } from "@/organizations/validation";

interface OrganizationHierarchyProps {
  initialTree: OrganizationHierarchyData | null;
  initialError?: ApiErrorPayload | null;
}

function statusLabel(status: Organization["status"]): string {
  switch (status) {
    case "ACTIVE":
      return "Active";
    case "INACTIVE":
      return "Inactive";
    case "ARCHIVED":
      return "Archived";
  }
}

function errorDetails(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(errorDetails);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(errorDetails);
  }
  return [];
}

export function OrganizationHierarchy({
  initialTree,
  initialError = null,
}: OrganizationHierarchyProps) {
  const [organizations, setOrganizations] = useState<Organization[]>(
    initialTree?.results ?? [],
  );
  const [loadError, setLoadError] = useState<ApiError | null>(
    initialError ? deserializeApiError(initialError) : null,
  );
  const [treeLoading, setTreeLoading] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(
    () =>
      new Set(
        (initialTree?.results ?? [])
          .filter((organization) => organization.parent === null)
          .map((organization) => organization.id),
      ),
  );
  const [selectedId, setSelectedId] = useState<number | null>(
    initialTree?.results.find((organization) => organization.parent === null)?.id ??
      initialTree?.results[0]?.id ??
      null,
  );
  const [focusedId, setFocusedId] = useState<number | null>(selectedId);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveParent, setMoveParent] = useState("");
  const [movePending, setMovePending] = useState(false);
  const [moveError, setMoveError] = useState<ApiError | null>(null);
  const [refreshWarning, setRefreshWarning] = useState<ApiError | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const treeItemRefs = useRef(new Map<number, HTMLDivElement>());

  const allRows = useMemo(
    () => buildOrganizationTreeRows(organizations, new Set(), true),
    [organizations],
  );
  const visibleRows = useMemo(
    () => buildOrganizationTreeRows(organizations, expandedIds),
    [organizations, expandedIds],
  );
  const moveParentOptions = useMemo(
    () =>
      allRows.filter(
        (row) =>
          row.organization.id !== selectedId &&
          row.organization.status !== "ARCHIVED",
      ),
    [allRows, selectedId],
  );
  const selected = organizations.find((organization) => organization.id === selectedId) ?? null;
  const ancestors = selected
    ? getOrganizationAncestors(selected.id, organizations)
    : [];
  const selectedParent = selected?.parent === null
    ? null
    : organizations.find((organization) => organization.id === selected?.parent) ?? null;

  useEffect(() => {
    if (focusedId !== null) treeItemRefs.current.get(focusedId)?.focus();
  }, [focusedId, visibleRows]);

  useEffect(() => {
    if (selectedId !== null && organizations.some((item) => item.id === selectedId)) return;
    const root = organizations.find((item) => item.parent === null) ?? organizations[0];
    setSelectedId(root?.id ?? null);
    setFocusedId(root?.id ?? null);
  }, [organizations, selectedId]);

  const reloadTree = useCallback(async () => {
    setTreeLoading(true);
    setLoadError(null);
    setRefreshWarning(null);
    try {
      const result = await getOrganizationTree();
      if (!result.ok) {
        setLoadError(deserializeApiError(result.error));
        return false;
      }
      setOrganizations(result.data.results);
      setExpandedIds((current) => {
        const next = new Set(current);
        for (const organization of result.data.results) {
          if (organization.parent === null) next.add(organization.id);
        }
        return next;
      });
      return true;
    } finally {
      setTreeLoading(false);
    }
  }, []);

  const selectOrganization = (organization: Organization) => {
    setSelectedId(organization.id);
    setSuccessMessage("");
  };

  const toggleExpanded = (id: number) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const focusRowAt = (index: number) => {
    const row = visibleRows[index];
    if (row) setFocusedId(row.organization.id);
  };

  const handleTreeKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    rowIndex: number,
  ) => {
    const row = visibleRows[rowIndex];
    if (!row) return;
    const organization = row.organization;
    const expanded = expandedIds.has(organization.id);

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusRowAt(Math.min(rowIndex + 1, visibleRows.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        focusRowAt(Math.max(rowIndex - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        focusRowAt(0);
        break;
      case "End":
        event.preventDefault();
        focusRowAt(visibleRows.length - 1);
        break;
      case "ArrowRight":
        event.preventDefault();
        if (row.hasChildren && !expanded) toggleExpanded(organization.id);
        else if (row.hasChildren && visibleRows[rowIndex + 1]?.level === row.level + 1) {
          focusRowAt(rowIndex + 1);
        }
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (row.hasChildren && expanded) toggleExpanded(organization.id);
        else if (organization.parent !== null) {
          const parentIndex = visibleRows.findIndex(
            (item) => item.organization.id === organization.parent,
          );
          if (parentIndex >= 0) focusRowAt(parentIndex);
        }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        selectOrganization(organization);
        break;
    }
  };

  const openMoveDialog = () => {
    if (!selected || selected.parent === null) return;
    const currentParentIsSelectable = moveParentOptions.some(
      (row) => row.organization.id === selected.parent,
    );
    setMoveParent(currentParentIsSelectable ? String(selected.parent) : "");
    setMoveError(null);
    setSuccessMessage("");
    setMoveOpen(true);
  };

  const confirmMove = async () => {
    if (!selected || selected.parent === null || !/^\d+$/.test(moveParent)) return;
    setMovePending(true);
    setMoveError(null);
    setRefreshWarning(null);
    setSuccessMessage("");
    try {
      const result = await moveOrganization(selected.id, Number(moveParent));
      if (!result.ok) {
        setMoveError(deserializeApiError(result.error));
        return;
      }

      setOrganizations((current) =>
        current.map((organization) =>
          organization.id === selected.id ? result.data.data : organization,
        ),
      );
      setExpandedIds((current) => new Set(current).add(Number(moveParent)));
      setMoveOpen(false);
      setSuccessMessage(`${selected.name} was moved successfully.`);

      const refreshed = await getOrganizationTree();
      if (refreshed.ok) {
        setOrganizations(refreshed.data.results);
      } else {
        setRefreshWarning(deserializeApiError(refreshed.error));
      }
    } finally {
      setMovePending(false);
    }
  };

  if (loadError && organizations.length === 0) {
    return (
      <ApiErrorState
        error={loadError}
        title="Could not load the organization hierarchy"
        onRetry={() => void reloadTree()}
      />
    );
  }

  if (organizations.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 5, textAlign: "center", borderRadius: 3 }}>
        <AccountTreeRoundedIcon color="disabled" sx={{ fontSize: 40 }} />
        <Typography variant="h6" sx={{ mt: 1, fontWeight: 700 }}>
          No organizations to display
        </Typography>
        <Typography color="text.secondary" variant="body2">
          Create an organization unit before browsing its hierarchy.
        </Typography>
        {loadError ? (
          <ApiErrorState error={loadError} onRetry={() => void reloadTree()} />
        ) : null}
      </Paper>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
      {loadError ? (
        <Alert severity="error" role="alert">
          The hierarchy could not be refreshed. The displayed tree may be out of date.{" "}
          {loadError.message}
        </Alert>
      ) : null}
      {refreshWarning ? (
        <Alert severity="warning" role="alert">
          The move was accepted, but the latest hierarchy could not be loaded. The tree shows
          the moved unit from the successful response. {refreshWarning.message}
        </Alert>
      ) : null}
      {successMessage ? (
        <Alert severity="success" role="status">
          {successMessage}
        </Alert>
      ) : null}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1.15fr) minmax(320px, 0.85fr)" },
          gap: 2.5,
          alignItems: "start",
        }}
      >
        <Paper variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              px: 2.5,
              py: 1.5,
              borderBottom: 1,
              borderColor: "divider",
            }}
          >
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1" fontWeight={700}>
                Structure
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {organizations.length} units · expand branches to explore deeper levels
              </Typography>
            </Box>
            <Button
              size="small"
              startIcon={treeLoading ? <CircularProgress size={16} /> : <RefreshRoundedIcon />}
              onClick={() => void reloadTree()}
              disabled={treeLoading}
              aria-label="Refresh organization hierarchy"
            >
              Refresh
            </Button>
          </Box>
          <Box
            role="tree"
            aria-label="Organization hierarchy"
            aria-busy={treeLoading}
            sx={{ p: 1.5, maxHeight: { xs: 520, lg: "calc(100vh - 270px)" }, overflow: "auto" }}
          >
            {visibleRows.map((row, rowIndex) => {
              const organization = row.organization;
              const isExpanded = expandedIds.has(organization.id);
              const isSelected = selectedId === organization.id;
              return (
                <Box
                  key={organization.id}
                  ref={(element: HTMLDivElement | null) => {
                    if (element) treeItemRefs.current.set(organization.id, element);
                    else treeItemRefs.current.delete(organization.id);
                  }}
                  role="treeitem"
                  aria-level={row.level + 1}
                  aria-expanded={row.hasChildren ? isExpanded : undefined}
                  aria-selected={isSelected}
                  tabIndex={
                    focusedId === organization.id ||
                    (focusedId === null && rowIndex === 0)
                      ? 0
                      : -1
                  }
                  onFocus={() => setFocusedId(organization.id)}
                  onClick={() => selectOrganization(organization)}
                  onKeyDown={(event) => handleTreeKeyDown(event, rowIndex)}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    minHeight: 48,
                    mb: 0.5,
                    pl: 1 + Math.min(row.level, 8) * 2,
                    pr: 1,
                    borderRadius: 2,
                    cursor: "pointer",
                    border: "1px solid",
                    borderColor: isSelected ? "primary.main" : "transparent",
                    bgcolor: isSelected ? "primary.50" : "transparent",
                    "&:hover": { bgcolor: isSelected ? "primary.50" : "action.hover" },
                    "&:focus-visible": {
                      outline: "3px solid",
                      outlineColor: "secondary.main",
                      outlineOffset: 1,
                    },
                  }}
                >
                  <Box
                    component="button"
                    type="button"
                    tabIndex={-1}
                    aria-label={`${isExpanded ? "Collapse" : "Expand"} ${organization.name}`}
                    onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                      event.stopPropagation();
                      toggleExpanded(organization.id);
                    }}
                    disabled={!row.hasChildren}
                    sx={{
                      display: "grid",
                      placeItems: "center",
                      width: 28,
                      height: 28,
                      p: 0,
                      border: 0,
                      borderRadius: 1.5,
                      color: "text.secondary",
                      bgcolor: "transparent",
                      cursor: row.hasChildren ? "pointer" : "default",
                    }}
                  >
                    {row.hasChildren ? (
                      isExpanded ? (
                        <ExpandMoreRoundedIcon fontSize="small" />
                      ) : (
                        <ChevronRightRoundedIcon fontSize="small" />
                      )
                    ) : null}
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" fontWeight={isSelected ? 700 : 600} noWrap>
                      {organization.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {organization.code} · {organizationTypeLabel(organization.organization_type)}
                    </Typography>
                  </Box>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={statusLabel(organization.status)}
                    sx={{ flexShrink: 0 }}
                  />
                </Box>
              );
            })}
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ borderRadius: 3, p: { xs: 2, sm: 2.5 } }}>
          {selected ? (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Box>
                <Typography variant="overline" color="primary.main" fontWeight={700}>
                  Selected organization
                </Typography>
                <Typography variant="h6" fontWeight={700}>
                  {selected.name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {selected.code} · {organizationTypeLabel(selected.organization_type)}
                </Typography>
              </Box>
              <Box component="nav" aria-label="Organization ancestors">
                <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                  Ancestors
                </Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.5 }}>
                  {ancestors.length === 0 ? (
                    <Typography variant="body2">Root organization</Typography>
                  ) : (
                    ancestors.map((ancestor) => (
                      <Box key={ancestor.id} sx={{ display: "inline-flex", alignItems: "center" }}>
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => {
                            selectOrganization(ancestor);
                            setFocusedId(ancestor.id);
                            let parent = ancestor.parent;
                            while (parent !== null) {
                              setExpandedIds((current) => new Set(current).add(parent as number));
                              parent =
                                organizations.find((item) => item.id === parent)?.parent ?? null;
                            }
                          }}
                          aria-label={`Go to ancestor ${ancestor.name}`}
                        >
                          {ancestor.code}
                        </Button>
                        <Typography aria-hidden="true" color="text.disabled">
                          /
                        </Typography>
                      </Box>
                    ))
                  )}
                  <Typography variant="body2" fontWeight={700} aria-current="location">
                    {selected.code}
                  </Typography>
                </Box>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  Current parent
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  {selectedParent
                    ? `${selectedParent.name} (${selectedParent.code})`
                    : "Root organization"}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <Chip label={statusLabel(selected.status)} size="small" />
                <Chip
                  label={`${countOrganizationDescendants(selected.id, organizations)} descendants`}
                  size="small"
                  variant="outlined"
                />
              </Box>
              {selected.parent === null ? (
                <Alert severity="info">
                  The institutional root is protected and cannot be moved.
                </Alert>
              ) : null}
              <Button
                variant="contained"
                onClick={openMoveDialog}
                disabled={selected.parent === null}
              >
                Move organization
              </Button>
            </Box>
          ) : (
            <Typography color="text.secondary">Select a unit in the tree to inspect it.</Typography>
          )}
        </Paper>
      </Box>

      <Dialog
        open={moveOpen}
        onClose={movePending ? undefined : () => setMoveOpen(false)}
        aria-labelledby="organization-move-title"
        aria-describedby="organization-move-description"
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle id="organization-move-title" fontWeight={700}>
          Move organization
        </DialogTitle>
        <DialogContent>
          {selected ? (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
              <Typography id="organization-move-description" variant="body2" color="text.secondary">
                Move <strong>{selected.name}</strong> to a new parent. The API validates parent
                existence, root rules, self-parenting and cycles.
              </Typography>
              <FormControl fullWidth>
                <InputLabel id="move-parent-label">New parent</InputLabel>
                <Select
                  labelId="move-parent-label"
                  id="move-parent"
                  label="New parent"
                  value={moveParent}
                  onChange={(event) => setMoveParent(event.target.value)}
                >
                  {moveParentOptions.map((row) => (
                    <MenuItem key={row.organization.id} value={String(row.organization.id)}>
                      {`${"— ".repeat(Math.min(row.level, 8))}${row.organization.code} · ${row.organization.name}`}
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>
                  The selected organization and archived units are not available as parents.
                  Descendant choices remain subject to authoritative backend cycle validation.
                </FormHelperText>
              </FormControl>
              <Alert severity="info">
                This changes the parent of {selected.code} and repositions its{" "}
                {countOrganizationDescendants(selected.id, organizations)} descendant
                {countOrganizationDescendants(selected.id, organizations) === 1 ? "" : "s"} under
                the new branch.
              </Alert>
              {moveError ? (
                <Alert severity="error" role="alert">
                  {moveError.message}
                  {errorDetails(moveError.details).map((detail, index) => (
                    <Typography key={`${detail}-${index}`} variant="body2" mt={0.5}>
                      {detail}
                    </Typography>
                  ))}
                  {moveError.requestId ? (
                    <Typography variant="caption" display="block" mt={0.5} fontFamily="monospace">
                      Reference: {moveError.requestId}
                    </Typography>
                  ) : null}
                </Alert>
              ) : null}
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setMoveOpen(false)} disabled={movePending} color="inherit">
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => void confirmMove()}
            disabled={movePending || !moveParent || Number(moveParent) === selected?.parent}
          >
            {movePending ? "Moving…" : "Confirm move"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
