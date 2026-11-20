import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('./bundles.mjs',import.meta.url));
function fixture(run){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'uog-bundle-fixture-'));
 try{fs.mkdirSync(path.join(root,'.next/static/chunks'),{recursive:true});return run(root);}
 finally{assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));assert(path.basename(root).startsWith('uog-bundle-fixture-'));fs.rmSync(root,{recursive:true,force:true});}
}
test('rejects development output rather than labelling it a production bundle baseline',()=>fixture(root=>{
 fs.writeFileSync(path.join(root,'.next/app-build-manifest.json'),JSON.stringify({pages:{}}));
 const result=spawnSync(process.execPath,[script,'--root',root],{encoding:'utf8'});
 assert.notEqual(result.status,0);assert.match(result.stderr,/require a production build/);
}));
test('deduplicates layout assets, flattens trace arrays and checks all route ceilings',()=>fixture(root=>{
 const routes=['/layout','/sites/[id]/admin/page','/sites/[id]/admin/pages/page','/sites/[id]/admin/posts/page','/sites/[id]/admin/media/page','/sites/[id]/admin/pages/new/page','/sites/[id]/admin/posts/new/page','/sites/[id]/admin/pages/[pageId]/builder/page'];
 fs.writeFileSync(path.join(root,'.next/BUILD_ID'),'fixture');
 fs.writeFileSync(path.join(root,'.next/static/chunks/common.js'),'const common=1;');
 fs.writeFileSync(path.join(root,'.next/static/chunks/page.js'),'const page=1;');
 fs.writeFileSync(path.join(root,'.next/app-build-manifest.json'),JSON.stringify({pages:Object.fromEntries(routes.map(route=>[route,route==='/layout'?['static/chunks/common.js']:['static/chunks/common.js','static/chunks/page.js']]))}));
 fs.writeFileSync(path.join(root,'.next/trace'),JSON.stringify([{name:'fixture-build',duration:1000},{name:'fixture-build',duration:2000}])+'\n');
 const result=spawnSync(process.execPath,[script,'--root',root,'--check'],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);const report=JSON.parse(result.stdout);
 assert.equal(report.routes.dashboard.raw,28);assert.equal(report.routes.dashboard.files.length,2);assert.equal(report.build_trace.event_count,2);assert.equal(report.build_trace.spans[0].total_ms,3);assert.equal(report.budget_status,'within_budget');
}));
