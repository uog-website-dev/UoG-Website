/** Isolate .next output from the running development workspace. */
import {cp,mkdir,mkdtemp,readdir,symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawn} from "node:child_process";
const mode=process.env.PERF_NEXT_MODE??"production";
if(!["production","development"].includes(mode))throw new Error("Unknown PERF_NEXT_MODE");
const root=await mkdtemp(join(tmpdir(),"uog-perf-"));
await cp("/workspace",root,{recursive:true,filter:source=>!source.split("/").some(part=>["node_modules",".next",".turbo","docs","coverage","dist","tmp"].includes(part))});
await symlink("/workspace/node_modules",join(root,"node_modules"),"dir");
for(const group of ["apps","packages"]){for(const entry of await readdir(`/workspace/${group}`,{withFileTypes:true})){
 if(!entry.isDirectory())continue;const directory=join(root,group,entry.name);await mkdir(directory,{recursive:true});
 await symlink(`/workspace/${group}/${entry.name}/node_modules`,join(directory,"node_modules"),"dir");
}}
const env={...process.env,NEXT_TELEMETRY_DISABLED:"1",NODE_ENV:mode};
const run=args=>new Promise((resolve,reject)=>{const child=spawn("pnpm",["--filter","@uog/admin-web",...args],{cwd:root,stdio:"inherit",env});child.on("exit",code=>code===0?resolve():reject(new Error("Performance service command failed")));process.on("SIGTERM",()=>child.kill("SIGTERM"));});
console.info(JSON.stringify({event:"uog.perf.mode",mode}));
if(mode==="production")await run(["build"]);
await run([mode==="production"?"start":"dev"]);
