import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import { Breadcrumb } from "@/breadcrumb";
import { AccessControlManager } from "@/app/access/access-control-manager";

export const metadata = { title: "Access control" };

export default function AccessControlPage() {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Box>
        <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Access control" }]} />
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>Access control</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Manage custom roles, registered capabilities, and scoped role assignments. Django validates every change against your current permissions and delegation scope.
        </Typography>
      </Box>
      <AccessControlManager />
    </Box>
  );
}
