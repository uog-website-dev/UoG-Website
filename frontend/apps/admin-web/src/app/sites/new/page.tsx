/**
 * Create a site.
 *
 * The form itself is the shared `SiteForm` in create mode: it holds no
 * existing row, so the code field is editable and no ETag is involved
 * (create is not a conditional write). The new site starts as Draft on the
 * server; activation is a separate, explicitly confirmed action.
 */
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import { Breadcrumb } from "@/breadcrumb";
import { SiteForm } from "@/sites/site-form";

export const metadata = { title: "New site" };

export default function NewSitePage() {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Box>
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            { label: "Sites", href: "/sites" },
            { label: "New site" },
          ]}
        />
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          New site
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Prepare a new web property: choose its owner, code, language and
          settings. The platform validates ownership and lifecycle rules on
          save, and the site is created as a draft.
        </Typography>
      </Box>

      <SiteForm site={null} />
    </Box>
  );
}
