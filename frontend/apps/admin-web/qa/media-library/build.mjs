import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const require=createRequire(import.meta.url);
const vitePath=require.resolve("vite",{paths:[dirname(require.resolve("vitest"))]});
const {build}=await import(pathToFileURL(vitePath));
const root=dirname(fileURLToPath(import.meta.url));
await build({configFile:false,root,base:"./",oxc:{jsx:{runtime:"automatic"}},resolve:{alias:[
 {find:"@/app/sites/media-actions",replacement:resolve(root,"actions.ts")},
 {find:"@uog/ui",replacement:resolve(root,"../../../../packages/ui/src/useAsync.ts")},
 {find:"@",replacement:resolve(root,"../../src")}
]},build:{outDir:resolve(root,"../../../../dist/media-library-qa"),emptyOutDir:true}});
