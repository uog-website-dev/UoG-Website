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
      '"Roboto", "Helvetica Neue", "Segoe UI", Arial, sans-serif',
    h1: { fontWeight: 700 },
    h2: { fontWeight: 700 },
    h3: { fontWeight: 600 },
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          borderRadius: 8,
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
  },
});
