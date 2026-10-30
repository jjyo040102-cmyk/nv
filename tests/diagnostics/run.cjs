/** Partial diagnostics ONLY. This is not a replacement for npm test / npm run check / E2E.
 * Default tools: installed TypeScript and JSZip. Explicit paths allow offline diagnostic reuse.
 * Database adapter: node:sqlite (not production better-sqlite3).
 */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module');
const {performance}=require('node:perf_hooks');
const {DatabaseSync}=require('node:sqlite');
const tsPath=process.env.ACTFLOW_DIAGNOSTIC_TYPESCRIPT||'typescript';
const zipPath=process.env.ACTFLOW_DIAGNOSTIC_JSZIP||'jszip';
const ts=require(tsPath),root=process.cwd(),out=fs.mkdtempSync(path.join(os.tmpdir(),'actflow-diagnostic-'));
const zipResolved=require.resolve(zipPath),zipVersion=require(path.join(path.dirname(zipResolved),'../package.json')).version;
const originalResolve=Module._resolveFilename;
const zodBundle=process.env.ACTFLOW_DIAGNOSTIC_ZOD_BUNDLE;
const withIntegration=process.env.ACTFLOW_DIAGNOSTIC_INTEGRATION==='true';
const installedZod=!zodBundle&&withIntegration?require.resolve('zod'):null;
let zodDescription=zodBundle?'Playwright-bundled Zod 3; NOT locked Zod 4':'not loaded';
if(installedZod)zodDescription='installed Zod '+require('zod/package.json').version;
if(zodBundle){const shim=path.join(out,'diagnostic-zod.js');fs.writeFileSync(shim,`const z=require(${JSON.stringify(zodBundle)}).zod;module.exports={...z,z};`);}
Module._resolveFilename=function(name,...args){return name==='jszip'?zipResolved:name==='zod'&&zodBundle?path.join(out,'diagnostic-zod.js'):name==='zod'&&installedZod?installedZod:originalResolve.call(this,name,...args);};
fs.writeFileSync(path.join(out,'package.json'),' {"type":"commonjs"} ');
let syntaxErrors=[],fileCount=0;
function walk(p){for(const e of fs.readdirSync(p,{withFileTypes:true})){const f=path.join(p,e.name);if(e.isDirectory())walk(f);else if(/\.tsx?$/.test(f)&&!f.endsWith('.d.ts')){const result=ts.transpileModule(fs.readFileSync(f,'utf8'),{fileName:f,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}});const dest=path.join(out,path.relative(root,f)).replace(/\.tsx?$/,'.js');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,result.outputText);fileCount++;for(const d of result.diagnostics||[])if(d.category===ts.DiagnosticCategory.Error)syntaxErrors.push({file:path.relative(root,f),message:ts.flattenDiagnosticMessageText(d.messageText,'\n')});}}}
class DiagnosticDatabase{
 constructor(filename=':memory:'){this.db=new DatabaseSync(filename);this.db.exec('PRAGMA foreign_keys=ON');this.depth=0;}
 prepare(sql){const s=this.db.prepare(sql);return {get:(...a)=>s.get(...a),all:(...a)=>s.all(...a),run:(...a)=>s.run(...a)};}
 pragma(sql){return this.db.prepare('PRAGMA '+sql).all();}
 exec(sql){return this.db.exec(sql);}
 close(){this.db.close();}
 transaction(fn){return(...a)=>{const name='diagnostic_'+this.depth++;this.db.exec('SAVEPOINT '+name);try{const value=fn(...a);if(value&&typeof value.then==='function')throw new Error('Async SQL transactions are forbidden');this.db.exec('RELEASE SAVEPOINT '+name);return value;}catch(e){this.db.exec('ROLLBACK TO SAVEPOINT '+name);this.db.exec('RELEASE SAVEPOINT '+name);throw e;}finally{this.depth--;}};}
}
(async()=>{
 const began=new Date().toISOString(),results=[];
 try{
  for(const dir of ['lib','tests/support'])walk(path.join(root,dir));
  if(syntaxErrors.length)throw new Error('Syntax diagnostics prevent execution');
  fs.cpSync(path.join(root,'data/demo'),path.join(out,'data/demo'),{recursive:true});
  const cases=[];require(path.join(out,'tests/support/release-boundary-cases.js')).registerReleaseBoundaries((name,fn)=>cases.push({name,fn}),filename=>new DiagnosticDatabase(filename));
  if(withIntegration) require(path.join(out,'tests/support/stabilization-cases.js')).registerStabilizationCases((name,fn)=>cases.push({name,fn}),filename=>new DiagnosticDatabase(filename));
  for(const c of cases){const start=performance.now();try{await c.fn();results.push({name:c.name,status:'PASS',durationMs:Math.round(performance.now()-start)});console.log('PASS '+c.name);}catch(e){results.push({name:c.name,status:'FAIL',durationMs:Math.round(performance.now()-start),error:e.stack||String(e)});console.error('FAIL '+c.name+'\n'+(e.stack||e));}}
 }catch(e){results.push({name:'diagnostic-startup',status:'FAIL',error:e.stack||String(e)});}
 finally{Module._resolveFilename=originalResolve;fs.rmSync(out,{recursive:true,force:true});}
 const report={kind:'PARTIAL_DIAGNOSTIC_NOT_RELEASE_GATE',began,finished:new Date().toISOString(),environment:{node:process.version,typescript:ts.version,jszip:zipVersion,database:'node:sqlite adapter; NOT better-sqlite3',zod:zodDescription},sourceFilesTranspiled:fileCount,syntaxErrors,passed:results.filter(r=>r.status==='PASS').length,failed:results.filter(r=>r.status==='FAIL').length,skipped:0,results};
 const destination=path.resolve(process.env.ACTFLOW_DIAGNOSTIC_REPORT||'validation/diagnostics.json');fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed:report.passed,failed:report.failed,skipped:0,environment:report.environment},null,2));process.exitCode=report.failed||syntaxErrors.length?1:0;
})();
