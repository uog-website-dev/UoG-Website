/** Build a temporary source copy; never overwrite the running dev .next tree. */
import {cp,mkdir,mkdtemp,readdir,symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawn} from "node:child_process";
const name=process.argv[2];
if(!["admin-web","public-web"].includes(name))throw new Error("Choose admin-web or public-web");
const root=await mkdtemp(join(tmpdir(),"sprint3-build-"));
await cp("/workspace",root,{recursive:true,filter:source=>!source.split("/").some(part=>["node_modules",".next",".turbo","docs","coverage"].includes(part))});
await symlink("/workspace/node_modules",join(root,"node_modules"),"dir");
for(const group of ["apps","packages"]){
 for(const entry of await readdir(`/workspace/${group}`,{withFileTypes:true})){
  if(!entry.isDirectory())continue;
  const directory=join(root,group,entry.name);await mkdir(directory,{recursive:true});
  await symlink(`/workspace/${group}/${entry.name}/node_modules`,join(directory,"node_modules"),"dir").catch(error=>{if(error.code!=="EEXIST")throw error;});
 }
}
const command=spawn("pnpm",["--filter",`@uog/${name}`,"build"],{cwd:root,stdio:"inherit",env:{...process.env,NEXT_TELEMETRY_DISABLED:"1"}});
command.on("exit",code=>process.exit(code??1));
