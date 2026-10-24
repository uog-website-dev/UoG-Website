/**
 * Create an organization unit.
 *
 * The form itself is the shared `OrganizationForm` in create mode: it holds no
 * existing row, so the code field is editable and no ETag is involved (create
 * is not a conditional write).
 */
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import { Breadcrumb } from "@/breadcrumb";
import { OrganizationForm } from "@/organizations/organization-form";

export const metadata = { title: "New organization" };

export default function NewOrganizationPage() {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Box>
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            { label: "Organizations", href: "/organizations" },
            { label: "New organization" },
          ]}
        />
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          New organization
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Add a unit to the institutional tree. The code is fixed once created;
          the platform validates type, parent and lifecycle rules on save.
        </Typography>
      </Box>

      <OrganizationForm organization={null} etag={null} />
    </Box>
  );
}
