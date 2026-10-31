/**
 * Module registry route — the platform capability catalogue.
 *
 * Renders the console chrome (breadcrumb + heading) as a server component
 * and hands the data work to `ModuleRegistry`, a client component that reads
 * through a server action so the Keycloak access token never reaches the
 * browser. The screen is read-only by design: registering or editing rows is
 * a backend concern, and per-site enable/disable lives on each site's
 * Modules screen.
 */
import ExtensionIcon from "@mui/icons-material/Extension";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

import { getEffectivePermissions } from "@/access-control";
import { Breadcrumb } from "@/breadcrumb";
import { ModuleRegistry } from "@/modules/module-registry";
import { canActivateCentralModules } from "@/sites/site-admin";

export const metadata = { title: "Module registry" };

export default async function ModulesPage() {
  const permissions = await getEffectivePermissions();
  if (!canActivateCentralModules(permissions)) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Modules" }]} />
        <Typography component="h1" variant="h4" sx={{ fontWeight: 700 }}>
          Modules
        </Typography>
        <Typography role="status">
          Central module activation is not available for this account.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Box>
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            { label: "Modules" },
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
            <ExtensionIcon fontSize="large" />
          </Box>
          <Box>
            <Chip
              size="small"
              label="Capability registry"
              color="primary"
              variant="outlined"
              sx={{ mb: 1, fontWeight: 600 }}
            />
            <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
              Modules
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5, maxWidth: 680 }}>
              Every platform capability the registry records, with its status
              and whether sites may enable it. A registry row is an
              announcement — only implemented, platform-wide enabled modules
              can run on a site.
            </Typography>
          </Box>
        </Paper>
      </Box>

      <ModuleRegistry />
    </Box>
  );
}
