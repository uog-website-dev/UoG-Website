import type { Metadata } from "next";

import { PublicSiteChrome } from "@/public-site";

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
        <PublicSiteChrome>{children}</PublicSiteChrome>
      </body>
    </html>
  );
}
