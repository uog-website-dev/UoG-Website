/**
 * Domain Management route — the central hostname directory.
 *
 * Renders the console chrome as a server component and hands the data work
 * to `DomainsList`, a client component that reads through server actions so
 * the Keycloak access token never reaches the browser. The screen is
 * read-only: hostname administration stays on each Site's detail screen,
 * where the per-site Domains panel owns it.
 */
import LanguageRoundedIcon from "@mui/icons-material/LanguageRounded";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

import { Breadcrumb } from "@/breadcrumb";
import { DomainsList } from "@/domains/domains-list";

export const metadata = { title: "Domains" };

export default function DomainsPage() {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Box>
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            { label: "Domains" },
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
              label="Platform-wide"
              color="primary"
              variant="outlined"
              sx={{ mb: 1, fontWeight: 600 }}
            />
            <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
              Domains
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5, maxWidth: 680 }}>
              Search every configured hostname across the platform, see which
              Site and organization owns it, and jump straight to a
              Site&apos;s details. Records are read from the platform API.
            </Typography>
          </Box>
        </Paper>
      </Box>

      <DomainsList />
    </Box>
  );
}
