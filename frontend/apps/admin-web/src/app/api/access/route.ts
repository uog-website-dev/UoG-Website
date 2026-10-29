import { NextResponse } from "next/server";

import { getEffectivePermissions } from "@/access-control";

export async function GET(request: Request) {
  const permissions = await getEffectivePermissions();
  return NextResponse.json(
    { permissions },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
