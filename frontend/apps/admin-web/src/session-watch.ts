"use client";

import { useEffect } from "react";

import { APP_BASE_PATH } from "@/base-path";
import { redirectToSignIn } from "@/session-expiry";

export const SESSION_CHECK_INTERVAL_MS = 60_000;

let redirecting = false;

/**
 * Starts a fresh sign-in when the session check reports it expired, and
 * resolves to whether it did. Network failures count as "not expired".
 *
 * The check, not an API 401, decides: an API that refuses a token the
 * session still considers valid would otherwise bounce between this
 * console and the sign-in route.
 */
export async function signInAgainIfExpired(): Promise<boolean> {
  if (redirecting) return true;
  try {
    const response = await fetch(`${APP_BASE_PATH}/api/session`, { cache: "no-store" });
    if (response.status !== 401) return false;
  } catch {
    return false;
  }
  redirecting = true;
  redirectToSignIn();
  return true;
}

/**
 * Re-checks the session when the tab regains focus and once a minute while
 * it is visible, so an idle tab does not keep showing a console whose every
 * request is refused.
 */
export function useSessionWatch(): void {
  useEffect(() => {
    let checking = false;
    async function check() {
      if (checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        await signInAgainIfExpired();
      } finally {
        checking = false;
      }
    }

    const onVisible = () => void check();
    const timer = window.setInterval(onVisible, SESSION_CHECK_INTERVAL_MS);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
