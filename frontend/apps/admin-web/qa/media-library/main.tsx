import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider, createTheme, CssBaseline, Box, Typography, TextField, MenuItem } from "@mui/material";
import { MediaLibrary } from "../../src/sites/media-library";
function Fixture() {
 const [site, setSite] = useState(11);
 return <ThemeProvider theme={createTheme()}><CssBaseline /><Box sx={{p:{xs:2,md:4},maxWidth:1400,mx:"auto"}}>
 <Typography variant="overline">Site Administration · Browser regression fixture</Typography>
 <Typography variant="h4" component="h1">{site===11 ? "Informatics" : "Medicine"}</Typography>
 <TextField select label="Active Site" value={site} onChange={e=>setSite(Number(e.target.value))} sx={{my:2,minWidth:200}}><MenuItem value={11}>Informatics</MenuItem><MenuItem value={22}>Medicine</MenuItem></TextField>
 <MediaLibrary siteId={site} canUpload={false} />
 </Box></ThemeProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
