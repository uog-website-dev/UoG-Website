/**
 * University of Gondar — shared Material UI theme.
 *
 * Both public-web and admin-web consume this theme so that branding stays
 * consistent across the platform. Adjust the tokens here, never per app.
 */
import { createTheme } from "@mui/material/styles";
import type { Theme } from "@mui/material/styles";

export const uogColors = {
  /** UoG deep navy — primary brand colour. */
  navy: "#003366",
  /** UoG gold — accent/secondary colour. */
  gold: "#FFB81C",
  ink: "#1a2332",
  mist: "#f4f7fb",
} as const;

export const uogTheme: Theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: uogColors.navy,
      contrastText: "#ffffff",
    },
    secondary: {
      main: uogColors.gold,
      contrastText: uogColors.ink,
    },
    background: {
      default: uogColors.mist,
      paper: "#ffffff",
    },
    text: {
      primary: uogColors.ink,
    },
  },
  shape: {
    borderRadius: 8,
  },
  typography: {
    fontFamily:
      '"Inter", "Source Sans 3", "Helvetica Neue", Arial, sans-serif',
    h1: { fontWeight: 700, fontSize: "2.25rem", lineHeight: 1.15, letterSpacing: "-0.02em" },
    h2: { fontWeight: 700, fontSize: "1.875rem", lineHeight: 1.2, letterSpacing: "-0.015em" },
    h3: { fontWeight: 600, fontSize: "1.5rem", lineHeight: 1.25 },
    h4: { fontWeight: 600, fontSize: "1.25rem", lineHeight: 1.3 },
    h5: { fontWeight: 600, fontSize: "1.125rem", lineHeight: 1.35 },
    h6: { fontWeight: 600, fontSize: "1rem", lineHeight: 1.4 },
    subtitle1: { fontWeight: 600, fontSize: "1.0625rem", lineHeight: 1.45 },
    body1: { fontSize: "1rem", lineHeight: 1.65 },
    body2: { fontSize: "0.9375rem", lineHeight: 1.6 },
    caption: { fontSize: "0.8125rem", lineHeight: 1.5 },
    button: { textTransform: "none", fontWeight: 600, letterSpacing: "0.01em" },
  },
  components: {
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          borderRadius: 8,
          "&:focus-visible": { outline: "3px solid", outlineColor: "currentColor", outlineOffset: 2 },
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
      },
    },
    MuiLink: {
      styleOverrides: {
        root: {
          "&:focus-visible": { outline: "3px solid", outlineColor: "currentColor", outlineOffset: 2, borderRadius: 2 },
        },
      },
    },
  },
});

/** Approved high-contrast presentation. It is selected only by a Site theme name. */
export const highContrastTheme: Theme = createTheme(uogTheme, {
  palette: {
    mode: "light",
    primary: { main: "#ffffff", contrastText: "#000000" },
    secondary: { main: "#ffff00", contrastText: "#000000" },
    background: { default: "#000000", paper: "#000000" },
    text: { primary: "#ffffff", secondary: "#ffffff" },
  },
});
