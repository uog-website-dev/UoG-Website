import {createHmac} from "node:crypto";
import {getSessionToken} from "@/session-jwt";

/** Non-credential session partition; access/refresh/id tokens never leave server. */
export async function getCacheIdentity(): Promise<string | null> {
  const token = await getSessionToken();
  if (!token?.sub) return null;
  if (typeof token.cacheSessionId === "string") return token.cacheSessionId;
  // Existing sessions predating this deployment remain isolated by subject/issued-at.
  return createHmac("sha256", process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "legacy-cache-partition")
    .update(`${token.sub}:${token.iat ?? "legacy"}`).digest("hex");
}
