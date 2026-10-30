import Database from 'better-sqlite3';
import {afterEach,expect,it,vi} from 'vitest';
import {runMigrations} from '../../lib/db/migrate';
import {WorkflowEngine} from '../../lib/workflow/engine';
import {TaskPlanner} from '../../lib/tasks/planner';
import {LivingTaskEngine} from '../../lib/tasks/engine';
import {EventRepository} from '../../lib/events/repository';
import {WakeEngine} from '../../lib/events/wake-engine';
import {EmailService} from '../../lib/email/service';
import {VerifiedContactRepository} from '../../lib/email/verified-contacts';
import {reconcileGmailSend} from '../../lib/email/reconcile';
const dbs:Database.Database[]=[];
afterEach(()=>{dbs.splice(0).forEach(db=>db.close());vi.unstubAllEnvs();});
async function setup(beforeSendFailure=false){
  vi.stubEnv('ACTFLOW_REAL_MAIL_ENABLED','true');const db=new Database(':memory:');dbs.push(db);runMigrations(db);
  const workflows=new WorkflowEngine(db,'unused'),planner=new TaskPlanner(db,workflows,undefined,()=>async()=>{throw new Error('No model needed');}),tasks=new LivingTaskEngine(db,workflows,planner);
  const events=new EventRepository(db),wake=new WakeEngine(db,events),sendDraft=vi.fn().mockRejectedValue(new Error('Response lost'));
  let checks=0;const preflight=async()=>{if(beforeSendFailure&&++checks===2)throw new Error('Disconnected before a send claim');};
  const service=new EmailService(db,tasks,events,wake,workflows,{name:'injected-uncertain-transport',externalEffect:'ACTUAL',sendDraft,preflight});
  const actor={id:'owner',sessionId:'workspace',role:'USER' as const};
  new VerifiedContactRepository(db).upsert({ownerSessionId:actor.sessionId,emailAddress:'partner@example.com',autoReplyEnabled:true});
  const incoming=await service.ingestTrusted({from:'partner@example.com',messageId:'gmail:incoming',threadId:'thread',subject:'Q',body:'Question',auth:{status:'PASS',trustedAdapter:true,spf:'PASS',dkim:'PASS',dmarc:'PASS'}},actor);
  await expect(service.reply(incoming.taskId,{subject:'Re: Q',body:'Answer'},actor)).rejects.toThrow();
  expect(tasks.get(incoming.taskId,actor)?.status).toBe(beforeSendFailure?'FAILED':'BLOCKED');expect(sendDraft).toHaveBeenCalledTimes(beforeSendFailure?0:1);
  const client={findSent:vi.fn(async()=> 'sent1' as string|null),verify:vi.fn(async()=>({ok:true,sent:true,messageId:'sent1',externalEffect:'ACTUAL' as const,remoteVerified:true}))};
  return {db,tasks,workflows,actor,taskId:incoming.taskId,client,sendDraft};
}
it('reopens explicit confirmation for a proven unsent draft without rerunning a model or sending',async()=>{
  const {db,tasks,workflows,actor,taskId,sendDraft}=await setup(true);
  expect(db.prepare('SELECT status FROM mail_outbox').get()).toEqual({status:'READY'});
  const result=await tasks.executeCurrent(taskId,actor);
  expect(result.status).toBe('WAITING_APPROVAL');expect(sendDraft).not.toHaveBeenCalled();
  expect(workflows.getSnapshot(result.currentWorkflowId!).approvals).toMatchObject([{kind:'CONFIRM',status:'PENDING'}]);
});
it('reconciles remote evidence and unblocks a single mail episode without resending',async()=>{
  const {db,tasks,actor,taskId,client,sendDraft}=await setup();
  await expect(reconcileGmailSend(db,client,'unused',taskId,actor)).resolves.toMatchObject({verified:true});
  expect(tasks.get(taskId,actor)?.status).toBe('WAITING_EVENT');expect(sendDraft).toHaveBeenCalledTimes(1);
  expect(db.prepare('SELECT status FROM mail_outbox').get()).toEqual({status:'SENT'});
  expect(db.prepare("SELECT * FROM verifications WHERE verifier_version='gmail-readback-v1'").all()).toHaveLength(1);
});
it('treats a missing sent message as uncertain and never retries delivery',async()=>{
  const {db,tasks,actor,taskId,client,sendDraft}=await setup();client.findSent.mockResolvedValue(null);
  await expect(reconcileGmailSend(db,client,'unused',taskId,actor)).resolves.toMatchObject({verified:false});
  expect(tasks.get(taskId,actor)?.status).toBe('BLOCKED');expect(client.verify).not.toHaveBeenCalled();expect(sendDraft).toHaveBeenCalledTimes(1);
  expect(db.prepare('SELECT status FROM mail_outbox').get()).toEqual({status:'UNKNOWN'});
});
it('preserves a cancellation while recording subsequently verified delivery',async()=>{
  const {db,tasks,actor,taskId,client}=await setup();tasks.cancel(taskId,actor);
  await reconcileGmailSend(db,client,'unused',taskId,actor);
  expect(tasks.get(taskId,actor)?.status).toBe('CANCELLED');
});
