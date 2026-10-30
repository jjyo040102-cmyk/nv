import Database from 'better-sqlite3';
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,sep} from 'node:path';
import {runMigrations} from '../../lib/db/migrate';
import {WorkflowEngine} from '../../lib/workflow/engine';
import {TaskPlanner} from '../../lib/tasks/planner';
import {LivingTaskEngine} from '../../lib/tasks/engine';
import {DemoProvider,OFFICIAL_DEMO_TEXT} from '../../lib/providers/demo';
import {responseDocxTool} from '../../lib/tools/artifactTools';
const dbs:Database.Database[]=[],roots:string[]=[];
afterEach(()=>{vi.restoreAllMocks();dbs.splice(0).forEach(db=>db.close());roots.splice(0).forEach(root=>{if(!resolve(root).startsWith(resolve(tmpdir())+sep))throw new Error('Unsafe cleanup');rmSync(root,{recursive:true,force:true});});});
async function setup(){
  const root=mkdtempSync(resolve(tmpdir(),'actflow-repair-'));roots.push(root);const db=new Database(':memory:');dbs.push(db);runMigrations(db);
  const analysis=await new DemoProvider().analyzeDocument({text:OFFICIAL_DEMO_TEXT,sourceName:'notice.txt'});
  const ids=['lookup','xlsx','docx','done'];analysis.tasks=ids.map((id,index)=>({...analysis.tasks.find(task=>task.id===id)!,dependsOn:index?[ids[index-1]]:[]}));
  analysis.edges=ids.slice(1).map((to,index)=>({from:ids[index],to,condition:'always' as const}));
  db.prepare('UPDATE settings SET retry_failed_steps_enabled=1').run();
  let plans=0;const workflows=new WorkflowEngine(db,root),planner=new TaskPlanner(db,workflows,undefined,()=>async()=>{plans++;return analysis;}),tasks=new LivingTaskEngine(db,workflows,planner);
  const actor={id:'owner',sessionId:'workspace',role:'USER' as const},task=tasks.createGoal({title:'Create verified files',goal:'Create a roster and response document'},actor);
  return {db,root,tasks,task,actor,plans:()=>plans};
}
it('compensates a committed earlier artifact before one bounded replan using the same goal',async()=>{
  const {db,root,tasks,task,actor,plans}=await setup();vi.spyOn(responseDocxTool,'execute').mockRejectedValueOnce(new Error('Injected artifact failure'));
  const result=await tasks.executeCurrent(task.id,actor);expect(result.status).toBe('WAITING_EVENT');expect(result.goal).toBe(task.goal);expect(plans()).toBe(2);
  const artifacts=db.prepare('SELECT a.state,a.relative_path FROM artifacts a JOIN workflows w ON w.id=a.workflow_id WHERE w.living_task_id=?').all(task.id) as Array<{state:string;relative_path:string}>;
  expect(artifacts.filter(a=>a.state==='COMMITTED')).toHaveLength(2);expect(artifacts.filter(a=>a.state==='DELETED')).toHaveLength(1);
  for(const artifact of artifacts)expect(existsSync(resolve(root,artifact.relative_path))).toBe(artifact.state==='COMMITTED');
  expect(db.prepare('SELECT * FROM task_repairs').all()).toHaveLength(1);
},20000);
it('stops after a second verification failure instead of creating an unbounded repair loop',async()=>{
  const {db,tasks,task,actor,plans}=await setup();vi.spyOn(responseDocxTool,'execute').mockRejectedValue(new Error('Persistent artifact failure'));
  await expect(tasks.executeCurrent(task.id,actor)).rejects.toThrow();expect(plans()).toBe(2);expect(tasks.get(task.id,actor)?.status).toBe('FAILED');
  expect(db.prepare("SELECT * FROM artifacts WHERE state='COMMITTED'").all()).toHaveLength(0);
},20000);
