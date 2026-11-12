"use client";

/**
 * Central module management: registry, Site activation and history tabs.
 *
 * The selected tab is kept in `?tab=` so a refresh or shared link returns to
 * it. After a committed operation every tab re-reads from the backend; no
 * activation state is cached here.
 */
import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import { useAsync } from "@uog/ui";

import { listModuleActivationSummary } from "@/app/modules/actions";
import type { ModuleActivationSummary } from "@/modules/bulk-contract";
import { ModuleRegistry } from "@/modules/module-registry";
import { OperationHistory } from "@/modules/operation-history";
import { SiteModuleManagement } from "@/modules/site-module-management";
import { unwrap } from "@/organizations/contract";

const TABS = [
  { value: "registry", label: "Registry" },
  { value: "sites", label: "Site module management" },
  { value: "history", label: "History" },
] as const;

type TabValue = (typeof TABS)[number]["value"];

function tabFromLocation(): TabValue {
  if (typeof window === "undefined") return "registry";
  const value = new URLSearchParams(window.location.search).get("tab");
  return TABS.some((tab) => tab.value === value) ? (value as TabValue) : "registry";
}

export function ModulesWorkspace() {
  const [tab, setTab] = useState<TabValue>("registry");
  const [refreshKey, setRefreshKey] = useState(0);
  const summary = useAsync<ModuleActivationSummary[]>(async () => unwrap(await listModuleActivationSummary()), [refreshKey]);

  useEffect(() => setTab(tabFromLocation()), []);

  const select = (value: TabValue) => {
    setTab(value);
    const url = new URL(window.location.href);
    if (value === "registry") url.searchParams.delete("tab");
    else url.searchParams.set("tab", value);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  };

  const modules = summary.data ?? [];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tabs
          value={tab}
          onChange={(_, value: TabValue) => select(value)}
          aria-label="Module management sections"
          variant="scrollable"
          allowScrollButtonsMobile
        >
          {TABS.map((item) => (
            <Tab key={item.value} value={item.value} label={item.label} id={`modules-tab-${item.value}`} aria-controls={`modules-panel-${item.value}`} />
          ))}
        </Tabs>
      </Box>

      {TABS.map((item) => (
        <Box
          key={item.value}
          role="tabpanel"
          id={`modules-panel-${item.value}`}
          aria-labelledby={`modules-tab-${item.value}`}
          hidden={tab !== item.value}
        >
          {tab === item.value && item.value === "registry" ? <ModuleRegistry refreshKey={refreshKey} onChanged={() => setRefreshKey((key) => key + 1)} /> : null}
          {tab === item.value && item.value !== "registry" && summary.error ? (
            <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => summary.reload()}>Try again</Button>}>
              The module registry could not be loaded. {summary.error.message}
            </Alert>
          ) : null}
          {tab === item.value && item.value === "sites" && !summary.error ? (
            <SiteModuleManagement
              modules={modules}
              onApplied={() => setRefreshKey((key) => key + 1)}
              onShowHistory={() => select("history")}
            />
          ) : null}
          {tab === item.value && item.value === "history" && !summary.error ? (
            <OperationHistory modules={modules} refreshKey={refreshKey} />
          ) : null}
        </Box>
      ))}
    </Box>
  );
}
