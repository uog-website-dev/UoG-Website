/**
 * Route-level loading state.
 *
 * Rendered inside the application shell while a server component under this
 * segment is still streaming — the header, navigation and breadcrumb-less
 * chrome stay interactive.
 */
import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";

export default function AdminLoading() {
  return (
    <Box
      role="status"
      aria-label="Loading page"
      sx={{ display: "flex", flexDirection: "column", gap: 3 }}
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <Skeleton width={160} height={20} />
        <Skeleton width={280} height={40} />
        <Skeleton width={380} height={24} />
      </Box>

      <Skeleton variant="rounded" height={56} />

      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(3, 1fr)" },
        }}
      >
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} variant="rounded" height={140} />
        ))}
      </Box>

      <Skeleton variant="rounded" height={120} />

      <span className="sr-only">Loading…</span>
    </Box>
  );
}
