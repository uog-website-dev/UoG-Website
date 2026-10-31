import { NextResponse } from "next/server";

import { getEffectivePermissions } from "@/access-control";

export async function GET(request: Request) {
  const site = new URL(request.url).searchParams.get("site");
  let siteId: number | undefined;
  if (site != null) {
    if (!/^[1-9]\d*$/.test(site)) {
      return NextResponse.json(
        { permissions: [] },
        { status: 400, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    siteId = Number(site);
  }
  const permissions = await getEffectivePermissions(siteId);
  return NextResponse.json(
    { permissions },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
