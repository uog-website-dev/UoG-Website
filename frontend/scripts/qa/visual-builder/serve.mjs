import {createRequire} from "node:module";
import {dirname} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";
const app=createRequire(new URL("../../../apps/admin-web/package.json",import.meta.url));
const {createServer,build}=await import(pathToFileURL(app.resolve("vite",{paths:[dirname(app.resolve("vitest"))]})).href);
const configFile=fileURLToPath(new URL("vite.config.mts",import.meta.url));
if(process.argv.includes("--build"))await build({configFile,build:{outDir:"/tmp/visual-builder-browser",emptyOutDir:true}});
else {const server=await createServer({configFile});await server.listen();server.printUrls();}
