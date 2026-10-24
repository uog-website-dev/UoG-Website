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
import Box from "@mui/material/Box";
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
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          Organizations
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Colleges, institutes and departments of the University of Gondar.
          Create and maintain units here; lifecycle changes are irreversible.
        </Typography>
      </Box>

      <OrganizationsList />
    </Box>
  );
}
