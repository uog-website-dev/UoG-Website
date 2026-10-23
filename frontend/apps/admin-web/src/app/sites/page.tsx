/**
 * Sites — section placeholder.
 *
 * Part of the application shell only: the route, breadcrumb, navigation
 * highlight and messaging exist so administrators can learn the console
 * layout. No site data is read or written yet.
 */
import WebIcon from "@mui/icons-material/Web";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Typography from "@mui/material/Typography";

import { Breadcrumb } from "@/breadcrumb";

export const metadata = { title: "Sites" };

export default function SitesPage() {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Box>
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            { label: "Sites" },
          ]}
        />
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          Sites
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Public websites and microsites managed by the platform.
        </Typography>
      </Box>

      <Alert severity="info" variant="outlined">
        <strong>Placeholder screen.</strong> Site management is not implemented
        yet — nothing on this page is backed by the platform API, and no site
        data is displayed or modified.
      </Alert>

      <Card variant="outlined">
        <Box
          sx={{
            p: 6,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 1.5,
            textAlign: "center",
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 56,
              height: 56,
              borderRadius: 2,
              bgcolor: "action.hover",
              color: "text.disabled",
            }}
          >
            <WebIcon fontSize="large" />
          </Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            No data source connected
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 480 }}>
            Listing, creating and editing sites — including domains and
            publishing state — will arrive with the sites management story,
            which will wire this screen to the protected Django API. Until
            then this view stays intentionally empty.
          </Typography>
        </Box>
      </Card>
    </Box>
  );
}
