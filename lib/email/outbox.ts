import { createHash,randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { DataGuard,type OutgoingItem } from '../security/data-guard';
import { readVerifiedArtifact } from '../security/verified-artifact';
import { EmailIdentityService } from '../security/email-identity';
import type { NormalizedEmailEvent } from '../events/email-normalizer';
import { normalizeEmailAddress } from '../events/email-normalizer';
import { recordActivity } from '../audit/activity';
import { assertTaskLease } from '../tasks/lease';
import type { MailSendResult,MailTransport,EmailReplyDraft } from './types';
export class MailSafetyError extends Error { constructor(readonly code:string){super(code);this.name='MailSafetyError';} }
export type StoredDraft={to:string;subject:string;body:string;threadId:string|null;projectId:string|null;artifactIds:string[];artifactHashes:Record<string,string>;bulkExport:boolean};
export type OutboxRow={id:string;owner_session_id:string;living_task_id:string;workflow_id:string;inbound_message_id:string;draft_hash:string;draft_json:string;requires_approval:number;status:'READY'|'SENDING'|'SENT'|'UNKNOWN'|'BLOCKED';result_json:string|null};
export function draftKey(inboundMessageId:string,draft:EmailReplyDraft):string{
  return createHash('sha256').update(JSON.stringify({inboundMessageId,subject:draft.subject,body:draft.body,artifactIds:[...(draft.artifactIds??[]),...(draft.attachments??[]).map(i=>i.artifactId??'unproven')].sort(),bulkExport:draft.bulkExport===true})).digest('hex');
}
export function findOutbox(db:Database.Database,ownerSessionId:string,inboundMessageId:string,draftHash:string):OutboxRow|null{
  return db.prepare('SELECT * FROM mail_outbox WHERE owner_session_id=? AND inbound_message_id=? AND draft_hash=?').get(ownerSessionId,inboundMessageId,draftHash) as OutboxRow|undefined??null;
}
export async function materializeDraftAttachments(db:Database.Database,root:string|undefined,owner:string,taskId:string,draft:EmailReplyDraft):Promise<Array<OutgoingItem&{artifactId:string;sha256:string}>>{
  if(draft.attachments?.some(i=>!i.artifactId))throw new MailSafetyError('ATTACHMENT_PROVENANCE_REQUIRED');
  const ids=[...new Set([...(draft.artifactIds??[]),...(draft.attachments??[]).map(i=>i.artifactId!)])];
  if(ids.length>50||ids.length&&!root)throw new MailSafetyError('ATTACHMENT_UNAVAILABLE');
  const output:Array<OutgoingItem&{artifactId:string;sha256:string}>=[];let bytes=0;
  for(const artifactId of ids){
    const item=await readVerifiedArtifact(db,root!,{artifactId,ownerSessionId:owner,livingTaskId:taskId});
    bytes+=item.buffer?.length??0;if(bytes>25*1024*1024)throw new MailSafetyError('ATTACHMENT_SIZE_LIMIT');output.push(item);
  }return output;
}
export function saveOutbox(db:Database.Database,input:{owner:string;taskId:string;workflowId:string;inboundMessageId:string;hash:string;draft:StoredDraft;requiresApproval:boolean;blocked:boolean}):void{
  const now=new Date().toISOString();db.prepare('INSERT INTO mail_outbox(id,owner_session_id,living_task_id,workflow_id,inbound_message_id,draft_hash,draft_json,requires_approval,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(),input.owner,input.taskId,input.workflowId,input.inboundMessageId,input.hash,JSON.stringify(input.draft),Number(input.requiresApproval),input.blocked?'BLOCKED':'READY',now,now);
}
/** Called only by the registered external.email.send tool, under the workflow/task lease. */
export async function sendGuardedDraft(db:Database.Database,workflowId:string,nodeId:string,args:{recipient:string;subject:string;body:string;threadId:string|null;livingTaskId:string},transport:MailTransport,root?:string):Promise<MailSendResult>{
  const outbox=db.prepare('SELECT o.* FROM mail_outbox o JOIN workflows w ON w.id=o.workflow_id AND w.owner_session_id=o.owner_session_id AND w.living_task_id=o.living_task_id WHERE o.workflow_id=?').get(workflowId) as OutboxRow|undefined;
  if(!outbox||outbox.living_task_id!==args.livingTaskId)throw new MailSafetyError('AUTHORITATIVE_OUTBOX_REQUIRED');
  assertTaskLease(db,outbox.living_task_id);
  const node=db.prepare('SELECT status,policy_class,action_type FROM workflow_nodes WHERE workflow_id=? AND id=?').get(workflowId,nodeId) as {status:string;policy_class:string;action_type:string}|undefined;
  const task=db.prepare('SELECT status,project_id,current_workflow_id FROM living_tasks WHERE id=? AND owner_session_id=?').get(outbox.living_task_id,outbox.owner_session_id) as {status:string;project_id:string|null;current_workflow_id:string|null}|undefined;
  if(!node||node.action_type!=='external.email.send'||node.status!=='RUNNING'||node.policy_class==='HUMAN_ONLY'||!task||task.current_workflow_id!==workflowId||['PAUSED','CANCELLED','COMPLETED','BLOCKED'].includes(task.status))throw new MailSafetyError('EXECUTION_BOUNDARY_REQUIRED');
  const draft=JSON.parse(outbox.draft_json) as StoredDraft;
  if(args.recipient!==draft.to||args.subject!==draft.subject||args.body!==draft.body||args.threadId!==draft.threadId||task.project_id!==draft.projectId)throw new MailSafetyError('DRAFT_BINDING_CHANGED');
  if(outbox.status==='SENT'&&outbox.result_json)return JSON.parse(outbox.result_json) as MailSendResult;
  if(outbox.status!=='READY')throw new MailSafetyError(outbox.status==='BLOCKED'?'EGRESS_BLOCKED':'UNKNOWN_SEND_OUTCOME');
  // Validate the connection before claiming a send. Recheck all authorization after this await.
  await transport.preflight?.(outbox.owner_session_id,{...draft,ownerSessionId:outbox.owner_session_id,inboundMessageId:outbox.inbound_message_id,idempotencyKey:outbox.id});
  const row=db.prepare("SELECT * FROM mail_messages WHERE owner_session_id=? AND living_task_id=? AND message_id=? AND direction='INBOUND'").get(outbox.owner_session_id,outbox.living_task_id,outbox.inbound_message_id) as {from_address:string;from_display_name:string|null;reply_to_address:string|null;thread_id:string|null;auth_json:string;created_at:string}|undefined;
  if(!row||row.from_address!==draft.to||row.thread_id!==draft.threadId||normalizeEmailAddress(draft.to)!==draft.to)throw new MailSafetyError('RECIPIENT_BINDING_CHANGED');
  const email:NormalizedEmailEvent={fromAddress:row.from_address,fromDisplayName:row.from_display_name,replyToAddress:row.reply_to_address,messageId:outbox.inbound_message_id,threadId:row.thread_id,auth:JSON.parse(row.auth_json),subject:'',body:'',receivedAt:row.created_at};
  const identityService=new EmailIdentityService(db);
  let identity=identityService.evaluate({ownerSessionId:outbox.owner_session_id,email});
  const attachments=await materializeDraftAttachments(db,root,outbox.owner_session_id,outbox.living_task_id,{...draft,artifactIds:draft.artifactIds});
  if(attachments.some(a=>draft.artifactHashes[a.artifactId]!==a.sha256))throw new MailSafetyError('ATTACHMENT_BINDING_CHANGED');
  const guard=await new DataGuard().evaluateOutgoing({ownerSessionId:outbox.owner_session_id,recipient:draft.to,verifiedRecipient:identity.eligible,allowedProjectId:draft.projectId,bulkExport:draft.bulkExport,items:[{name:'email-content.txt',sourceOwnerSessionId:outbox.owner_session_id,sourceProjectId:draft.projectId,classification:'INTERNAL',text:draft.subject+'\n'+draft.body},...attachments]});
  if(guard.decision==='BLOCK')throw new MailSafetyError('EGRESS_BLOCKED');
  identity=identityService.evaluate({ownerSessionId:outbox.owner_session_id,email});
  const approved=db.prepare("SELECT 1 FROM approvals a JOIN settings s ON s.id=1 WHERE a.workflow_id=? AND a.node_id=? AND a.status='APPROVED' AND a.policy_version=s.organization_policy_version").get(workflowId,nodeId);
  if((outbox.requires_approval===1||!identity.eligible||guard.decision!=='ALLOW'||node.policy_class!=='AUTO')&&!approved)throw new MailSafetyError('FRESH_APPROVAL_REQUIRED');
  // Real mail adapters must explicitly declare their effect and require operator opt-in.
  if(transport.externalEffect!=='SIMULATED'&&(transport.externalEffect!=='ACTUAL'||process.env.ACTFLOW_REAL_MAIL_ENABLED!=='true'))throw new MailSafetyError('REAL_MAIL_NOT_ENABLED');
  // No await between the final identity/approval recheck and the atomic claim/send call.
  assertTaskLease(db,outbox.living_task_id);
  const latestTask=db.prepare('SELECT status,project_id,current_workflow_id FROM living_tasks WHERE id=?').get(outbox.living_task_id) as {status:string;project_id:string|null;current_workflow_id:string|null};
  if(latestTask.project_id!==draft.projectId||latestTask.current_workflow_id!==workflowId)throw new MailSafetyError('TASK_SCOPE_CHANGED');
  if(['PAUSED','CANCELLED','COMPLETED','BLOCKED'].includes(latestTask.status))throw new MailSafetyError('TASK_STOPPED');
  const liveWorkflow=db.prepare('SELECT status FROM workflows WHERE id=?').get(workflowId) as {status:string};
  if(liveWorkflow.status!=='RUNNING')throw new MailSafetyError('WORKFLOW_STOPPED');
  const currentPolicy=db.prepare('SELECT 1 FROM policy_decisions p JOIN settings s ON s.id=1 WHERE p.workflow_id=? AND p.node_id=? AND p.policy_version=s.organization_policy_version').get(workflowId,nodeId);
  if(!currentPolicy)throw new MailSafetyError('POLICY_CHANGED');
  if(db.prepare("UPDATE mail_outbox SET status='SENDING',updated_at=? WHERE id=? AND status='READY'").run(new Date().toISOString(),outbox.id).changes!==1)throw new MailSafetyError('OUTBOX_ALREADY_CLAIMED');
  try{
    const result=await transport.sendDraft({ownerSessionId:outbox.owner_session_id,inboundMessageId:outbox.inbound_message_id,to:draft.to,subject:draft.subject,body:draft.body,threadId:draft.threadId,idempotencyKey:outbox.id,attachments:attachments.map(a=>({name:a.name,contentType:a.contentType??'application/octet-stream',bytes:a.buffer!}))});
    if(!result.ok||!result.sent||typeof result.messageId!=='string'||!result.messageId.trim()||result.messageId.length>500||/[\r\n\0]/.test(result.messageId)||result.externalEffect!==transport.externalEffect)throw new MailSafetyError('INVALID_SEND_CONFIRMATION');
    if(result.externalEffect==='ACTUAL'&&result.remoteVerified!==true)throw new MailSafetyError('REMOTE_VERIFICATION_REQUIRED');
    db.transaction(()=>{
      db.prepare("UPDATE mail_outbox SET status='SENT',result_json=?,updated_at=? WHERE id=? AND status='SENDING'").run(JSON.stringify(result),new Date().toISOString(),outbox.id);
      db.prepare("INSERT INTO mail_messages(id,owner_session_id,living_task_id,message_id,thread_id,direction,from_address,from_display_name,reply_to_address,to_address,subject,body,auth_json,workflow_id,created_at) VALUES (?,?,?,?,?,'OUTBOUND',?,NULL,NULL,?,?,?,?,?,?)")
        .run(randomUUID(),outbox.owner_session_id,outbox.living_task_id,result.messageId,draft.threadId,result.externalEffect==='SIMULATED'?'actflow@local.invalid':'',draft.to,draft.subject,draft.body,'{}',workflowId,new Date().toISOString());
      recordActivity(db,outbox.owner_session_id,outbox.living_task_id,'MAIL_SEND_CONFIRMED',{outboxId:outbox.id,externalEffect:result.externalEffect});
    })();return result;
  }catch{
    db.prepare("UPDATE mail_outbox SET status='UNKNOWN',updated_at=? WHERE id=? AND status='SENDING'").run(new Date().toISOString(),outbox.id);
    db.prepare("UPDATE living_tasks SET status='BLOCKED',waiting_reason='메일 전송 결과를 확인해야 합니다. 자동 재발송을 차단했습니다.',version=version+1,updated_at=? WHERE id=? AND status NOT IN ('CANCELLED','COMPLETED','PAUSED')").run(new Date().toISOString(),outbox.living_task_id);
    recordActivity(db,outbox.owner_session_id,outbox.living_task_id,'MAIL_OUTCOME_UNKNOWN',{outboxId:outbox.id});throw new MailSafetyError('UNKNOWN_SEND_OUTCOME');
  }
}
