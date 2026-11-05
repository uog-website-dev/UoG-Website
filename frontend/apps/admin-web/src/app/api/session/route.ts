import { NextResponse } from "next/server";

import { getSessionState } from "@/access-token";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await getSessionState();
  return NextResponse.json(
    { state },
    {
      status: state === "active" ? 200 : 401,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
