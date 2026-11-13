import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";
export default function LoadingBuilder(){return <Box role="status" sx={{p:4,display:"flex",gap:2,alignItems:"center"}}><CircularProgress size={24}/>Loading Visual Builder…</Box>;}
