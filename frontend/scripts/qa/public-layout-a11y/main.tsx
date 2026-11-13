import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import Box from "@mui/material/Box";
import { PublicPageView, pageFromResponse } from "../../../packages/ui/src/public-page";
import { uogTheme } from "../../../packages/ui/src/theme";
import type { VisualLayout } from "@uog/types";

const asset="00000000-0000-4000-8000-000000000001";
const hostile='<img src=x onerror="window.__injected=true">';
const layout:VisualLayout={schema_version:1,rows:[{
  id:"three-columns",type:"section",ratios:[1,1,1],columns:[
    {id:"first",type:"column",children:[
      {id:"heading-one",type:"headline",props:{text:"Images and slides",level:2}},
      {id:"slider",type:"image_slider",props:{items:[
        {id:"first-slide",asset_id:asset,alt:"Wide campus photograph",caption:"First campus image"},
        {id:"second-slide",asset_id:asset,alt:hostile,caption:hostile},
      ]}},
    ]},
    {id:"second",type:"column",children:[
      {id:"heading-two",type:"headline",props:{text:"Tabbed content",level:2}},
      {id:"tabs",type:"tabs",props:{items:[{id:"overview",title:"Overview",text:"Read the overview."},{id:"details",title:"Details",text:hostile}]}},
      {id:"long-text",type:"editor",props:{html:'<p>'+"LongUnbrokenText".repeat(40)+'</p><script>window.__injected=true</script><a href="javascript:window.__injected=true">Unsafe rich text link</a>'}},
    ]},
    {id:"third",type:"column",children:[
      {id:"heading-three",type:"headline",props:{text:"Questions and links",level:2}},
      {id:"accordion",type:"accordion",props:{items:[{id:"question-one",title:"First question",text:"First answer"},{id:"question-two",title:"Second question",text:hostile}]}},
      {id:"safe-link",type:"button",props:{label:"Read more",href:"/about"}},
    ]},
  ],
}]};
const params=new URLSearchParams(location.search);
const scenario=params.get("scenario");
if(scenario==="script-url") (layout.rows[0]!.columns[2]!.children[2]!.props as {href:string}).href="javascript:alert(1)";
if(scenario==="style-token") (layout.rows[0]!.style as unknown)={tone:"url(javascript:alert(1))"};
if(scenario==="unknown-version") (layout as unknown as {schema_version:number}).schema_version=99;
if(scenario==="foreign-media") (layout.rows[0]!.columns[0]!.children[1]!.props as {items:unknown[]}).items=[{id:"foreign",asset_id:"../../secret",alt:"Foreign media",caption:"Invalid reference"}];
const document=pageFromResponse(200,{title:"Accessible published layout",site:11,blocks:[],metadata:{visual_layout:layout}});
createRoot(window.document.getElementById("root")!).render(
  <ThemeProvider theme={uogTheme}><CssBaseline/><Box component="main" sx={{p:2,maxWidth:1440,mx:"auto"}}>
    <PublicPageView page={document} privateMediaBase={params.get("surface")==="preview"?"/admin/sites/11/media":undefined}/>
  </Box></ThemeProvider>,
);
