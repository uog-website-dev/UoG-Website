import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const app=createRequire(new URL("../../../apps/admin-web/package.json",import.meta.url));
export default {
  root:fileURLToPath(new URL(".",import.meta.url)),
  oxc:{jsx:{runtime:"automatic"}},
  resolve:{alias:[
    ...["react","react-dom","@mui/material","@emotion/react","@emotion/styled"].map(name=>({find:name,replacement:dirname(app.resolve(`${name}/package.json`))})),
    {find:"@uog/types",replacement:fileURLToPath(new URL("../../../packages/types/src/index.ts",import.meta.url))},
  ]},
  server:{host:"0.0.0.0",port:4176,strictPort:true,fs:{allow:["/workspace"]}},
};
