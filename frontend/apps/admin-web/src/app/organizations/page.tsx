/**
 * Organizations — section placeholder.
 *
 * Part of the application shell only: the route, breadcrumb, navigation
 * highlight and messaging exist so administrators can learn the console
 * layout. No organization data is read or written yet.
 */
import BusinessIcon from "@mui/icons-material/Business";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Typography from "@mui/material/Typography";

import { Breadcrumb } from "@/breadcrumb";

export const metadata = { title: "Organizations" };

export default function OrganizationsPage() {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Box>
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            { label: "Organizations" },
          ]}
        />
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          Organizations
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Colleges, institutes and departments of the University of Gondar.
        </Typography>
      </Box>

      <Alert severity="info" variant="outlined">
        <strong>Placeholder screen.</strong> Organization management is not
        implemented yet — nothing on this page is backed by the platform API,
        and no organization data is displayed or modified.
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
            <BusinessIcon fontSize="large" />
          </Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            No data source connected
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 480 }}>
            Listing, creating and editing organizations will arrive with the
            organizations management story, which will wire this screen to the
            protected Django API. Until then this view stays intentionally
            empty.
          </Typography>
        </Box>
      </Card>
    </Box>
  );
}
