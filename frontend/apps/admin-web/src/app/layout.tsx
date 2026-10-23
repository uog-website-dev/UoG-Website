import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { UogFooter, UogHeader, UogThemeProvider } from "@uog/ui";

import { AdminShell } from "@/admin-shell";
import { auth } from "@/auth";
import { signInWithKeycloak, signOutFromSite } from "@/app/actions";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "UoG Admin Console",
    template: "%s · UoG Admin Console",
  },
  description:
    "Administration console of the University of Gondar Digital Platform (development).",
};

/** Renders the header control exactly like the plain link it replaced. */
const linkButtonStyle: CSSProperties = {
  background: "none",
  border: 0,
  padding: 0,
  color: "inherit",
  font: "inherit",
  fontSize: 14,
  cursor: "pointer",
};

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();

  if (!session) {
    return (
      <html lang="en" suppressHydrationWarning>
        <body>
          <UogThemeProvider>
            <UogHeader title="Admin Console" />
            <Box
              component="main"
              sx={{ display: "flex", justifyContent: "center", px: 2, py: { xs: 8, sm: 12 } }}
            >
              <Paper elevation={3} sx={{ p: { xs: 3, sm: 5 }, maxWidth: 440, textAlign: "center" }}>
                <Typography variant="h5" component="h1" sx={{ fontWeight: 700, mb: 1.5 }}>
                  Sign in required
                </Typography>
                <Typography color="text.secondary" sx={{ mb: 3 }}>
                  The administration console is restricted to University of Gondar
                  staff. Sign in with your university account to continue.
                </Typography>
                <form action={signInWithKeycloak}>
                  <Button type="submit" variant="contained" size="large" fullWidth>
                    Sign in with Keycloak
                  </Button>
                </form>
              </Paper>
            </Box>
            <UogFooter />
          </UogThemeProvider>
        </body>
      </html>
    );
  }

  const actions = (
    <Box component="span" sx={{ display: "flex", gap: 1.5, alignItems: "center" }}>
      <Box component="span" sx={{ fontSize: 14, opacity: 0.9 }}>
        {session.user?.email ?? session.user?.name ?? "signed in"}
      </Box>
      <form action={signOutFromSite} style={{ display: "inline" }}>
        <button type="submit" style={linkButtonStyle}>
          Sign out
        </button>
      </form>
    </Box>
  );

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <UogThemeProvider>
          <AdminShell actions={actions}>{children}</AdminShell>
        </UogThemeProvider>
      </body>
    </html>
  );
}
