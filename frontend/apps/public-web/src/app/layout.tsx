import type { Metadata } from "next";
import { headers } from "next/headers";

import { PublicSiteChrome } from "@/public-site";
import { publicMenusForHost, publicSiteForHost } from "@/public-metadata";

import "./globals.css";

export const metadata: Metadata = {
  title: "University of Gondar — Public Portal",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const host = (await headers()).get("host");
  const site = await publicSiteForHost(host);
  // Menus join the first HTML response so primary navigation does not pop in
  // after hydration. The backend's delivery cache is versioned on publish.
  const menus = site.modules.menus ? await publicMenusForHost(host, site.id) : null;
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <PublicSiteChrome initialSite={site} initialMenus={menus}>{children}</PublicSiteChrome>
      </body>
    </html>
  );
}
