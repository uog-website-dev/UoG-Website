/**
 * Organizations — the institutional tree management screen.
 *
 * Renders the shared application shell chrome (breadcrumb + heading) as a
 * server component and hands the data work to `OrganizationsList`, a client
 * component that reads through a server action so the Keycloak access token
 * never reaches the browser.
 *
 * This screen is intentionally honest about what is wired: listing, editing
 * and the deactivate/archive transitions are real API calls. The backend still
 * gates writes behind development mode plus an explicit opt-in, and enforces
 * authentication, the `platform-admin` realm role, ETag preconditions and the
 * database lifecycle rules — so a write in a shared environment is refused by
 * the server, and that refusal is shown rather than masked.
 */
import AccountTreeRoundedIcon from "@mui/icons-material/AccountTreeRounded";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

import { Breadcrumb } from "@/breadcrumb";
import { OrganizationsList } from "@/organizations/organizations-list";

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
            <AccountTreeRoundedIcon fontSize="large" />
          </Box>
          <Box>
            <Chip
              size="small"
              label="University structure"
              color="primary"
              variant="outlined"
              sx={{ mb: 1, fontWeight: 600 }}
            />
            <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
              Organizations
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5, maxWidth: 680 }}>
              Browse colleges, institutes, departments and other units across
              the University of Gondar. Search the directory or refine it with
              filters.
            </Typography>
          </Box>
        </Paper>
      </Box>

      <OrganizationsList />
    </Box>
  );
}
