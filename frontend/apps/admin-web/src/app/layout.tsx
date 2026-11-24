import type { Metadata } from "next";
import { Suspense, type CSSProperties } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import {UogThemeProvider} from "@uog/ui/theme-provider";
import {ToastProvider} from "@uog/ui/toast";

import { redirect } from "next/navigation";

import { APP_BASE_PATH } from "@/base-path";
import { getAccessToken } from "@/access-token";
import {getCacheIdentity} from "@/cache-identity";
import {SessionSignOutForm} from "@/session-sign-out-form";
import { NavigationTiming } from "@/performance/navigation-timing";
import { AdminShell } from "@/admin-shell";
import { auth, siteOrigin } from "@/auth";
import { signInWithKeycloak, signOutFromSite } from "@/app/actions";
import { sessionExpiredHref } from "@/session-expiry";
import { SignInNotice } from "@/sign-in-notice";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "UoG Admin Console",
    template: "%s · UoG Admin Console",
  },
  description:
    "Administration console of the University of Gondar Digital Platform (development).",
};

/** Renders the header control exactly like the plain link it replaced. */
const linkButtonStyle: CSSProperties = {
  background: "none",
  border: 0,
  padding: 0,
  color: "inherit",
  font: "inherit",
  fontSize: 14,
  cursor: "pointer",
};

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();

  if (session && !(await getAccessToken())) {
    redirect(`${siteOrigin}${sessionExpiredHref()}`);
  }

  if (!session) {
    return (
      <html lang="en" suppressHydrationWarning>
        <body>
          <UogThemeProvider>
            <Box
              component="main"
              sx={{
                position: "relative",
                display: "grid",
                placeItems: "center",
                minHeight: "100dvh",
                overflow: "hidden",
                px: 2,
                py: { xs: 4, sm: 8 },
                background: "radial-gradient(circle at 12% 18%, rgba(23, 74, 120, .12), transparent 28rem), radial-gradient(circle at 88% 84%, rgba(213, 163, 58, .16), transparent 24rem), #f3f6fa",
              }}
            >
              <Box sx={{ width: "min(100%, 29rem)" }}>
                <Paper
                  elevation={0}
                  sx={{
                    p: { xs: 3, sm: 5 },
                    textAlign: "center",
                    border: "1px solid",
                    borderColor: "rgba(194, 207, 222, .8)",
                    borderTop: "4px solid",
                    borderTopColor: "secondary.main",
                    borderRadius: 4,
                    boxShadow: "0 24px 65px rgba(31, 55, 82, .12), 0 3px 10px rgba(31, 55, 82, .04)",
                    bgcolor: "background.paper",
                  }}
                >
                  <Box
                    component="img"
                    src={`${APP_BASE_PATH}/uog-main-logo.webp`}
                    alt="University of Gondar logo"
                    sx={{ display: "block", width: 144, height: 96, objectFit: "contain", mx: "auto", mb: 2 }}
                  />
                  <Typography variant="overline" color="primary.main" sx={{ fontWeight: 800, letterSpacing: ".12em" }}>
                    UoG Digital Platform
                  </Typography>
                  <Typography variant="h4" component="h1" sx={{ fontWeight: 800, letterSpacing: "-.03em", mt: 0.5 }}>
                    Sign in to continue
                  </Typography>
                  <Typography color="text.secondary" sx={{ mt: 1.5, mb: 3 }}>
                    Use your University of Gondar account to access administration and publishing tools.
                  </Typography>
                  <Suspense fallback={null}>
                    <SignInNotice />
                  </Suspense>
                  <form action={signInWithKeycloak}>
                    <Button type="submit" variant="contained" size="large" fullWidth sx={{ minHeight: 52, fontWeight: 700 }}>
                      Continue to sign in
                    </Button>
                  </form>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 3 }}>
                    Secure access for University of Gondar staff
                  </Typography>
                </Paper>
              </Box>
              <Typography component="footer" variant="caption" color="text.secondary" sx={{ position: "absolute", bottom: 20, px: 2, textAlign: "center" }}>
                © {new Date().getFullYear()} University of Gondar · Digital Platform
              </Typography>
            </Box>
          </UogThemeProvider>
        </body>
      </html>
    );
  }

  const cacheIdentity = await getCacheIdentity();
  if (!cacheIdentity) redirect(`${siteOrigin}${sessionExpiredHref()}`);
  const actions = (
    <Box component="span" sx={{ display: "flex", gap: 1.5, alignItems: "center" }}>
      <Box component="span" sx={{ fontSize: 14, opacity: 0.9, display: { xs: "none", md: "inline" }, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {session.user?.email ?? session.user?.name ?? "signed in"}
      </Box>
      <SessionSignOutForm action={signOutFromSite}>
        <button type="submit" style={linkButtonStyle}>
          Sign out
        </button>
      </SessionSignOutForm>
    </Box>
  );

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <UogThemeProvider>
          {/* ToastProvider backs useToast() for success/failure notices on
              mutation screens (create/edit/lifecycle). */}
          <ToastProvider>
            {process.env.PERF_INSTRUMENTATION_ENABLED==="1"?<NavigationTiming/>:null}
            <AdminShell identity={cacheIdentity} actions={actions}>{children}</AdminShell>
          </ToastProvider>
        </UogThemeProvider>
      </body>
    </html>
  );
}
