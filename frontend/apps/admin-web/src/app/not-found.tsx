/**
 * Not-found route inside the admin shell.
 *
 * Rendered for any unmatched path under the console base path; the header
 * and navigation from the root layout remain available.
 */
import SearchOffIcon from "@mui/icons-material/SearchOff";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Typography from "@mui/material/Typography";
import Link from "next/link";

export default function AdminNotFound() {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
        Page not found
      </Typography>
      <Typography color="text.secondary">
        The address you opened does not match any screen in the admin console.
      </Typography>

      <Card variant="outlined" sx={{ width: "100%", mt: 1 }}>
        <Box
          sx={{
            p: 5,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 1.5,
            textAlign: "center",
          }}
        >
          <SearchOffIcon sx={{ fontSize: 48, color: "text.disabled" }} />
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            404 — no such admin screen
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
            Check the address, or use the sidebar to jump to a management
            section. Only the routes listed in the navigation exist today.
          </Typography>
        </Box>
      </Card>

      <Box sx={{ display: "flex", gap: 1.5, mt: 1 }}>
        <Button variant="contained" component={Link} href="/">
          Back to dashboard
        </Button>
        <Button variant="outlined" component={Link} href="/organizations">
          Organizations
        </Button>
      </Box>
    </Box>
  );
}
