import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Paper from "@mui/material/Paper";

export default function OrganizationHierarchyLoading() {
  return (
    <Box role="status" aria-label="Loading organization hierarchy">
      <Skeleton variant="text" width={240} height={28} />
      <Skeleton variant="rounded" height={130} sx={{ mb: 3, borderRadius: 3 }} />
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "1.15fr 0.85fr" },
          gap: 2.5,
        }}
      >
        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3 }}>
          <Skeleton variant="text" width={180} height={32} />
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} variant="rounded" height={42} sx={{ my: 1 }} />
          ))}
        </Paper>
        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3 }}>
          <Skeleton variant="text" width={220} height={36} />
          <Skeleton variant="text" width="80%" />
          <Skeleton variant="rounded" height={42} sx={{ mt: 3 }} />
        </Paper>
      </Box>
    </Box>
  );
}
