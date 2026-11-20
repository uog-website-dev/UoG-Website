import type { Metadata } from "next";
import { headers } from "next/headers";

import { PublicSiteChrome } from "@/public-site";
import { publicSiteForHost } from "@/public-metadata";

import "./globals.css";

export const metadata: Metadata = {
  title: "University of Gondar — Public Portal",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const site = await publicSiteForHost((await headers()).get("host"));
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <PublicSiteChrome initialSite={site}>{children}</PublicSiteChrome>
      </body>
    </html>
  );
}
