/** Packaging-only diagnostics. Does NOT execute the application or the Vitest suite. */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { isSupportedNode } from '../../scripts/check-runtime.mjs';
import { initializeLocalEnv } from '../../scripts/initialize-local-env.mjs';
const results = [];
async function check(name, fn) {
  try { await fn(); results.push({name,status:'PASS'}); }
  catch (error) { results.push({name,status:'FAIL',error:String(error)}); }
}
for (const v of ['20.19.0','22.16.0','22.22.1','24.14.0','25.0.0']) await check('reject '+v,()=>assert.equal(isSupportedNode(v), false));
for (const v of ['22.22.2','22.23.0','24.15.0','24.18.0','26.0.0']) await check('accept '+v,()=>assert.equal(isSupportedNode(v), true));
const dir = mkdtempSync(join(tmpdir(),'actflow-packaging-diagnostic-'));
try {
  await check('environment initialization is non-destructive',async()=>{
    await initializeLocalEnv(dir); const original=readFileSync(join(dir,'.env.local'),'utf8');
    await initializeLocalEnv(dir); assert.equal(readFileSync(join(dir,'.env.local'),'utf8'),original);
  });
  await check('master/session keys are distinct',()=>{
    const values=[...readFileSync(join(dir,'.env.local'),'utf8').matchAll(/(?:MASTER_KEY|SESSION_SECRET)=([a-f0-9]{64})/g)].map(m=>m[1]);
    assert.equal(values.length,2);assert.notEqual(values[0],values[1]);
  });
  await check('source ZIP does not need a .git directory to test ignore rules',()=>{
    const git=join(dir,'ignore-fixture');mkdirSync(git);writeFileSync(join(git,'.gitignore'),readFileSync('.gitignore'));
    execFileSync('git',['init','-q'],{cwd:git});
    for(const name of ['.env','.env.local','data/runtime/actflow.sqlite','data/runtime/actflow.sqlite-wal','data/runtime/actflow.sqlite-shm','data/runtime/benchmarks/result.json'])
      assert.equal(execFileSync('git',['check-ignore',name],{cwd:git,encoding:'utf8'}).trim(),name);
  });
  await check('package and lockfile engine constraint match',()=>assert.equal(JSON.parse(readFileSync('package.json')).engines.node,JSON.parse(readFileSync('package-lock.json')).packages[''].engines.node));
} finally { rmSync(dir,{recursive:true,force:true}); }
const report={kind:'PARTIAL_PACKAGING_DIAGNOSTIC',finished:new Date().toISOString(),node:process.version,passed:results.filter(r=>r.status==='PASS').length,failed:results.filter(r=>r.status==='FAIL').length,results};
mkdirSync('validation',{recursive:true});writeFileSync('validation/packaging-diagnostics.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));process.exitCode=report.failed?1:0;
