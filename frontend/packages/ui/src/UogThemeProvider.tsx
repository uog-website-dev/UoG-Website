"use client";

/**
 * SSR-safe Material UI theme registry.
 *
 * Wraps children with the shared UoG theme and the Next.js App Router
 * emotion cache so MUI styles render correctly on the server.
 */
import { CssBaseline, ThemeProvider } from "@mui/material";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import type { ReactNode } from "react";

import { highContrastTheme, uogTheme } from "./theme";

export function UogThemeProvider({
  children,
  theme = "institutional",
}: {
  children: ReactNode;
  theme?: "institutional" | "high-contrast";
}) {
  return (
    <AppRouterCacheProvider>
      <ThemeProvider theme={theme === "high-contrast" ? highContrastTheme : uogTheme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
