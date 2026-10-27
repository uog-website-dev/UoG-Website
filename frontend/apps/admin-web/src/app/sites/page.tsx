/**
 * Sites — the managed-website administration screen.
 *
 * Renders the application shell chrome (breadcrumb + heading) as a server
 * component and hands the data work to `SitesList`, a client component that
 * reads through a server actions so the Keycloak access token never reaches
 * the browser.
 *
 * The screen is honest about what is wired: listing, creating, editing,
 * configuration merges and the activate/suspend/archive transitions are real
 * API calls against the Django Sites API. The backend still gates writes
 * behind development mode plus an explicit opt-in, and enforces
 * authentication, the `platform-admin` realm role, `If-Match` preconditions
 * and the database lifecycle rules — so a write in a shared environment is
 * refused by the server, and that refusal is shown rather than masked.
 *
 * This screen deliberately does not render public pages, CMS navigation or
 * any claim about DNS/TLS provisioning: no such capability exists in the
 * platform API, so none is implied here.
 */
import LanguageRoundedIcon from "@mui/icons-material/LanguageRounded";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

import { Breadcrumb } from "@/breadcrumb";
import { SitesList } from "@/sites/sites-list";

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
            <LanguageRoundedIcon fontSize="large" />
          </Box>
          <Box>
            <Chip
              size="small"
              label="Managed websites"
              color="primary"
              variant="outlined"
              sx={{ mb: 1, fontWeight: 600 }}
            />
            <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
              Sites
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5, maxWidth: 680 }}>
              Public websites and microsites owned by university units. Search
              the directory, refine it with filters, and manage each site&apos;s
              lifecycle and settings.
            </Typography>
          </Box>
        </Paper>
      </Box>

      <SitesList />
    </Box>
  );
}
