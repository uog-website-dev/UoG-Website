import {notFound} from "next/navigation";
import {SiteWorkspace} from "@/sites/site-workspace";
export const metadata = {title: "Site administration"};
export default async function SiteAdminLayout({children, params}: {children: React.ReactNode; params: Promise<{id: string}>}) {
  const {id} = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) notFound();
  return <SiteWorkspace siteId={Number(id)}>{children}</SiteWorkspace>;
}
