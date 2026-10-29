/**
 * Access management route — user search, role assignments and the audit
 * trail.
 *
 * Renders the console chrome as a server component and hands the data work
 * to `AccessScreen`, a client component that reads through server actions so
 * the Keycloak access token never reaches the browser. The backend is the
 * sole authority on who may manage access: it answers 403 for unauthorized
 * callers, which the screen renders as a permission-denied state rather than
 * an empty one.
 */
import AdminPanelSettingsRoundedIcon from "@mui/icons-material/AdminPanelSettingsRounded";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

import { Breadcrumb } from "@/breadcrumb";
import { AccessScreen } from "@/access/access-screen";

export const metadata = { title: "Access" };

export default function AccessPage() {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Box>
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            { label: "Access" },
          ]}
        />
        <Paper
          variant="outlined"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: { xs: 2, sm: 3 },
            p: { xs: 2.5, sm: 3.5 },
            borderRadius: 3,
            background:
              "linear-gradient(115deg, rgba(0,51,102,0.08), rgba(255,255,255,0.96) 64%, rgba(255,184,28,0.14))",
          }}
        >
          <Box
            sx={{
              display: { xs: "none", sm: "grid" },
              placeItems: "center",
              flex: "0 0 auto",
              width: 64,
              height: 64,
              borderRadius: 3,
              bgcolor: "primary.main",
              color: "primary.contrastText",
              boxShadow: 2,
            }}
          >
            <AdminPanelSettingsRoundedIcon fontSize="large" />
          </Box>
          <Box>
            <Chip
              size="small"
              label="Platform-wide"
              color="primary"
              variant="outlined"
              sx={{ mb: 1, fontWeight: 600 }}
            />
            <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
              Access management
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5, maxWidth: 680 }}>
              Find an existing account, see the permissions it effectively
              holds, and grant or revoke roles within the scopes you manage.
              Every change is validated and audited by the backend.
            </Typography>
          </Box>
        </Paper>
      </Box>

      <AccessScreen />
    </Box>
  );
}
