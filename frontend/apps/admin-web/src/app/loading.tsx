/**
 * Shown the moment a menu item is chosen, before that screen's code and data
 * arrive. Without this boundary the previous screen stays in place for the
 * whole wait, so a click feels frozen.
 */
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";

export default function Loading() {
  return (
    <Box
      role="status"
      aria-live="polite"
      aria-busy="true"
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        minHeight: 320,
      }}
    >
      <CircularProgress size={36} />
      <Typography variant="body2" color="text.secondary">
        Opening…
      </Typography>
    </Box>
  );
}
