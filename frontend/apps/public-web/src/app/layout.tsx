import type { Metadata } from "next";
import Container from "@mui/material/Container";
import { UogFooter, UogHeader, UogThemeProvider } from "@uog/ui";

import { PublicMenus } from "@/public-menus";

import "./globals.css";

export const metadata: Metadata = {
  title: "University of Gondar — Public Portal",
  description:
    "Public website of the University of Gondar Digital Platform (development).",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <UogThemeProvider>
          <UogHeader title="Digital Platform — Public Website" />
          <PublicMenus>
            <Container maxWidth="lg" sx={{ py: 4, display: "flex", flexDirection: "column", minHeight: "70vh" }}>
              {children}
            </Container>
          </PublicMenus>
          <UogFooter apiBaseUrl={undefined} />
        </UogThemeProvider>
      </body>
    </html>
  );
}
