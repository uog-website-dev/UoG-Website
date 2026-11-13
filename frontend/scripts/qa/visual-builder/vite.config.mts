import {createRequire} from "node:module";
import {dirname} from "node:path";
import {fileURLToPath} from "node:url";
const fixture=fileURLToPath(new URL(".",import.meta.url));
const source=fileURLToPath(new URL("../../../apps/admin-web/src",import.meta.url));
const app=createRequire(new URL("../../../apps/admin-web/package.json",import.meta.url));
export default {
 root:fixture, oxc:{jsx:{runtime:"automatic"}},
 define:{"process.env.NEXT_PUBLIC_BASE_PATH":JSON.stringify("/admin")},
 resolve:{alias:[
  ...["react","react-dom","@mui/material","@emotion/react","@emotion/styled"].map(name=>({find:name,replacement:dirname(app.resolve(`${name}/package.json`))})),
  {find:"@mui/icons-material",replacement:dirname(app.resolve("@mui/icons-material/AddRounded"))},
  {find:"@/app/sites/page-actions",replacement:`${fixture}/actions.ts`},
  {find:"@/sites/media-picker",replacement:`${fixture}/media.tsx`},
  {find:"next/navigation",replacement:`${fixture}/navigation.tsx`},
  {find:"next/link",replacement:`${fixture}/navigation.tsx`},
  {find:"@uog/ui",replacement:fileURLToPath(new URL("../../../packages/ui/src/index.ts",import.meta.url))},
  {find:"@uog/types",replacement:fileURLToPath(new URL("../../../packages/types/src/index.ts",import.meta.url))},
  {find:"@",replacement:source},
 ]}, server:{host:"0.0.0.0",port:4175,strictPort:true,fs:{allow:["/workspace"]}},
};
