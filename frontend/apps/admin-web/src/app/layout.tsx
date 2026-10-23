import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import { UogFooter, UogHeader, UogThemeProvider } from "@uog/ui";

import { auth } from "@/auth";
import { signInWithKeycloak, signOutFromSite } from "@/app/actions";

// API base URL for admin - goes through nginx
const apiBaseUrl = "/api";

import "./globals.css";

export const metadata: Metadata = {
  title: "UoG Admin Console",
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

  const actions = session ? (
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
  ) : (
    <form action={signInWithKeycloak} style={{ display: "inline" }}>
      <button type="submit" style={linkButtonStyle}>
        Sign in
      </button>
    </form>
  );

  return (
    <html lang="en">
      <body>
        <UogThemeProvider>
          <UogHeader title="Digital Platform — Admin Console" actions={actions} />
          <Container maxWidth="lg" sx={{ py: 4, display: "flex", flexDirection: "column", minHeight: "70vh" }}>
            {children}
          </Container>
          <UogFooter />
        </UogThemeProvider>
      </body>
    </html>
  );
}
