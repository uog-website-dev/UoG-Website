/* Detach a long local benchmark without putting credentials on disk or a command line. */
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const input=fs.readFileSync(0);JSON.parse(input.toString('utf8'));
const out=path.resolve(process.env.PERF_OUTPUT||'docs/qa/P0-PERF-001/local');fs.mkdirSync(out,{recursive:true});
const log=fs.openSync(path.join(out,'run.log'),'w');
const child=spawn(process.execPath,[path.resolve('scripts/perf/benchmark.cjs')],{cwd:process.cwd(),env:process.env,detached:true,windowsHide:true,stdio:['pipe',log,log]});
child.stdin.end(input,()=>child.stdin.destroy());child.unref();fs.closeSync(log);
fs.writeFileSync(path.join(out,'launcher.json'),JSON.stringify({pid:child.pid,mode:process.env.PERF_MODE,launched_at:new Date().toISOString()},null,2));
console.log(JSON.stringify({pid:child.pid,output:out}));
