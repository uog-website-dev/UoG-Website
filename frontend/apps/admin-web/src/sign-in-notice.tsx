"use client";

import Alert from "@mui/material/Alert";
import { useSearchParams } from "next/navigation";

/** Auth.js error codes (`?error=`) as an administrator should read them. */
const MESSAGES: Record<string, string> = {
  AccessDenied: "Your account is not allowed to use the administration console.",
  Configuration:
    "Sign-in did not complete. This usually happens when the sign-in page stayed open too long or sign-in was started in another tab. Sign in again.",
};

const FALLBACK = "Sign-in did not complete. Sign in again.";

export function SignInNotice() {
  const error = useSearchParams().get("error");
  if (!error) return null;
  return (
    <Alert severity="warning" role="alert" sx={{ mb: 3, textAlign: "left" }}>
      {MESSAGES[error] ?? FALLBACK}
    </Alert>
  );
}
