import {useState} from "react";
import {createRoot} from "react-dom/client";
import {ThemeProvider,createTheme} from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import Box from "@mui/material/Box";
import {VisualBuilder} from "../../../apps/admin-web/src/sites/visual-builder";
function App(){
 const [site,setSite]=useState(11);const [page,setPage]=useState("00000000-0000-4000-8000-000000000001");const [role,setRole]=useState("Editor");
 return <ThemeProvider theme={createTheme()}><CssBaseline/><Box sx={{p:{xs:1,md:3},bgcolor:"#f3f5f8",minHeight:"100vh"}}>
 <Box component="header" sx={{display:"flex",gap:2,flexWrap:"wrap",mb:2}}><strong>Browser component fixture</strong>
 <label>Active Site <select aria-label="Active Site" value={site} onChange={event=>setSite(Number(event.target.value))}><option value={11}>Informatics</option><option value={22}>Medicine</option></select></label>
 <label>Active Page <select aria-label="Active Page" value={page} onChange={event=>setPage(event.target.value)}><option value="00000000-0000-4000-8000-000000000001">Welcome</option><option value="00000000-0000-4000-8000-000000000002">Another Page</option></select></label>
 <label>Fixture role <select aria-label="Fixture role" value={role} onChange={event=>setRole(event.target.value)}>{["Editor","Viewer","PAGES disabled"].map(value=><option key={value}>{value}</option>)}</select></label></Box>
 <VisualBuilder siteId={site} siteName={site===11?"Informatics":"Medicine"} pageId={page} builderEnabled={role!=="PAGES disabled"} permissions={role==="Viewer"?["content.pages.view"]:["content.pages.view","content.pages.update"]}/>
 </Box></ThemeProvider>;
}
createRoot(document.getElementById("root")!).render(<App/>);
