import AccountTreeRoundedIcon from "@mui/icons-material/AccountTreeRounded";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

import { Breadcrumb } from "@/breadcrumb";
import { getOrganizationTree } from "@/app/organizations/actions";
import { OrganizationHierarchy } from "@/organizations/organization-hierarchy";

export const metadata = { title: "Organization hierarchy" };

export default async function OrganizationHierarchyPage() {
  const result = await getOrganizationTree();

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Box>
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            { label: "Organizations", href: "/organizations" },
            { label: "Hierarchy" },
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
            aria-hidden="true"
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
              label="Hierarchy management"
              color="primary"
              variant="outlined"
              sx={{ mb: 1, fontWeight: 600 }}
            />
            <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
              Organization hierarchy
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
              Explore units at every depth and move an organization under a new
              parent. The backend remains authoritative for hierarchy and
              authorization rules.
            </Typography>
          </Box>
        </Paper>
      </Box>

      <OrganizationHierarchy
        initialTree={result.ok ? result.data : null}
        initialError={result.ok ? null : result.error}
      />
    </Box>
  );
}
