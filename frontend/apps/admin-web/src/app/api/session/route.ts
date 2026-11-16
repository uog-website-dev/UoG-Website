import { NextResponse } from "next/server";

import { getSessionState } from "@/access-token";
import {getCacheIdentity} from "@/cache-identity";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await getSessionState();
  const cacheIdentity = state === "active" ? await getCacheIdentity() : null;
  return NextResponse.json(
    { state: state === "active" && !cacheIdentity ? "expired" : state, cacheIdentity },
    {
      status: state === "active" && cacheIdentity ? 200 : 401,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
