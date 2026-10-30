import {afterEach,expect,it} from 'vitest';import type Database from 'better-sqlite3';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {resolve} from 'node:path';import {openDatabase} from '../../lib/db';import {runMigrations} from '../../lib/db/migrate';import {WorkflowEngine,type WorkflowAnalyzer} from '../../lib/workflow/engine';import {TaskPlanner} from '../../lib/tasks/planner';import {LivingTaskEngine} from '../../lib/tasks/engine';import type {WorkflowAnalysis} from '../../lib/domain/types';
const dbs:Database.Database[]=[];const roots:string[]=[];afterEach(()=>{dbs.splice(0).forEach(db=>db.close());roots.splice(0).forEach(r=>rmSync(r,{recursive:true,force:true}));});const analysis:WorkflowAnalysis={summary:'safe plan',facts:[],tasks:[{id:'done',title:'done',kind:'COMPLETION',actionType:'workflow.complete',dependsOn:[],condition:null,expectedOutput:null,suggestedPolicy:'AUTO',risk:{moneyMovement:0,externalTransmission:0,sensitiveData:0,legalEffect:0,organizationalAuthority:0,userRepresentation:0,destructiveMutation:0,reversibility:5}}],edges:[],warnings:[],provider:{provider:'demo',model:'test',mode:'demo',realModelCalled:false}};it('creates a linked workflow episode and executes through WorkflowEngine',async()=>{const root=mkdtempSync(resolve(tmpdir(),'actflow-task-'));roots.push(root);const db=openDatabase({dataDir:root,dbPath:':memory:',demoAuth:true,maxUploadMb:25});dbs.push(db);runMigrations(db);const wf=new WorkflowEngine(db,root);const planner=new TaskPlanner(db,wf,undefined,async()=>async()=>analysis);const engine=new LivingTaskEngine(db,wf,planner);const actor={id:'u',sessionId:'a',role:'USER' as const};const task=engine.createGoal({title:'T',goal:'G'},actor);const plan=await engine.planNext(task.id,actor);const row=db.prepare('SELECT living_task_id FROM workflows WHERE id=?').get(plan.workflowId) as any;expect(row.living_task_id).toBe(task.id);const done=await engine.executeCurrent(task.id,actor);expect(done.status).toBe('WAITING_EVENT');});

it('treats completed and cancelled tasks as terminal and only resumes paused tasks',async()=>{
  const root=mkdtempSync(resolve(tmpdir(),'actflow-task-state-'));roots.push(root);
  const db=openDatabase({dataDir:root,dbPath:':memory:',demoAuth:true,maxUploadMb:25});dbs.push(db);runMigrations(db);
  const wf=new WorkflowEngine(db,root);const planner=new TaskPlanner(db,wf,undefined,async()=>async()=>analysis);const engine=new LivingTaskEngine(db,wf,planner);
  const actor={id:'u',sessionId:'a',role:'USER' as const};
  const completed=engine.createGoal({title:'done',goal:'done'},actor);await engine.planNext(completed.id,actor);await engine.executeCurrent(completed.id,actor);
  const {GoalContracts}=await import('../../lib/tasks/goal-contract'); const contracts=new GoalContracts(db),contract=contracts.view(completed.id,actor.sessionId)!; await contracts.complete(completed.id,actor,contract.version,contract.requirements.filter(item=>item.canConfirm).map(item=>item.id),root);
  await expect(engine.executeCurrent(completed.id,actor)).rejects.toThrow(/terminal/i);
  await expect(engine.resume(completed.id,actor)).rejects.toThrow(/paused/i);
  const cancelled=engine.createGoal({title:'cancel',goal:'cancel'},actor);engine.cancel(cancelled.id,actor);
  await expect(engine.executeCurrent(cancelled.id,actor)).rejects.toThrow(/terminal/i);
  await expect(engine.resume(cancelled.id,actor)).rejects.toThrow(/paused/i);
});

it('does not replan or auto-run tasks that are paused, blocked, or waiting for approval on wake',async()=>{
  const root=mkdtempSync(resolve(tmpdir(),'actflow-task-protected-wake-'));roots.push(root);
  const db=openDatabase({dataDir:root,dbPath:':memory:',demoAuth:true,maxUploadMb:25});dbs.push(db);runMigrations(db);
  const wf=new WorkflowEngine(db,root);let analyses=0;const planner=new TaskPlanner(db,wf,undefined,async()=>async()=>{analyses++;return analysis;});const engine=new LivingTaskEngine(db,wf,planner);
  const actor={id:'u',sessionId:'a',role:'USER' as const};
  for(const status of ['PAUSED','BLOCKED','WAITING_APPROVAL'] as const){
    const task=engine.createGoal({title:status,goal:'g'},actor);
    db.prepare('UPDATE living_tasks SET status=? WHERE id=?').run(status,task.id);
    const result=await engine.handleWake(task.id,actor,`wake-${status}`);
    expect(result.status).toBe(status);
    expect(db.prepare('SELECT COUNT(*) AS c FROM workflows WHERE living_task_id=?').get(task.id)).toMatchObject({c:0});
  }
  expect(analyses).toBe(0);
});

it('preserves rollback cleanup for a workflow belonging to a paused task',async()=>{
  const root=mkdtempSync(resolve(tmpdir(),'actflow-cleanup-'));roots.push(root);
  const db=openDatabase({dataDir:root,dbPath:':memory:',demoAuth:true,maxUploadMb:25});dbs.push(db);runMigrations(db);
  const wf=new WorkflowEngine(db,root);const planner=new TaskPlanner(db,wf,undefined,async()=>async()=>analysis);const engine=new LivingTaskEngine(db,wf,planner);
  const actor={id:'u',sessionId:'a',role:'USER' as const};const task=engine.createGoal({title:'T',goal:'G'},actor);const plan=await engine.planNext(task.id,actor);
  db.prepare("UPDATE living_tasks SET status='PAUSED' WHERE id=?").run(task.id);
  db.prepare("UPDATE workflows SET status='PAUSED' WHERE id=?").run(plan.workflowId);
  const cleaned=await wf.discardTemporaryArtifacts(plan.workflowId,actor);
  expect(cleaned.rollback.status).toBe('ROLLED_BACK');expect(engine.get(task.id,actor)?.status).toBe('PAUSED');
  await expect(wf.executeWorkflow(plan.workflowId,actor)).rejects.toThrow();
});
