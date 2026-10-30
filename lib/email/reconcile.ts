import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ApiError } from '../api/responses';
import { recordActivity } from '../audit/activity';
import { assertTaskLease,withTaskLease } from '../tasks/lease';
import type { SessionActor } from '../domain/types';
import { materializeDraftAttachments,type OutboxRow,type StoredDraft } from './outbox';
import type { GmailClient } from './gmail-client';

/** Read-only remote reconciliation: absence is inconclusive and never authorizes another send. */
export function reconcileGmailSend(db:Database.Database,client:Pick<GmailClient,'findSent'|'verify'>,dataDir:string,taskId:string,actor:SessionActor) {
  return withTaskLease(db,taskId,actor.sessionId,async()=>{
    const row=db.prepare("SELECT * FROM mail_outbox WHERE owner_session_id=? AND living_task_id=? AND status='UNKNOWN' ORDER BY rowid DESC LIMIT 1").get(actor.sessionId,taskId) as OutboxRow|undefined;
    if(!row)throw new ApiError(409,'결과를 다시 확인할 메일이 없습니다.');
    const messageId=await client.findSent(actor.sessionId,row.id);
    if(!messageId)return {verified:false,message:'보낸편지함에서 확인되지 않았습니다. 결과를 확정할 수 없어 재발송을 차단한 상태를 유지합니다.'};
    const draft=JSON.parse(row.draft_json) as StoredDraft;
    const files=await materializeDraftAttachments(db,dataDir,actor.sessionId,taskId,draft);
    if(files.some(file=>file.sha256!==draft.artifactHashes[file.artifactId]))throw new ApiError(409,'승인한 첨부파일이 변경되어 발송 결과를 확인할 수 없습니다.');
    const result=await client.verify(actor.sessionId,messageId,{...draft,ownerSessionId:actor.sessionId,inboundMessageId:row.inbound_message_id,idempotencyKey:row.id,attachments:files.map(file=>({name:file.name,contentType:file.contentType??'application/octet-stream',bytes:file.buffer!}))});
    if(result.externalEffect!=='ACTUAL'||!result.remoteVerified||!result.sent||!result.ok)throw new ApiError(409,'Gmail 확인 근거가 부족합니다.');
    assertTaskLease(db,taskId);
    return db.transaction(()=>{
      const now=new Date().toISOString();
      if(db.prepare("UPDATE mail_outbox SET status='SENT',result_json=?,updated_at=? WHERE id=? AND status='UNKNOWN'").run(JSON.stringify(result),now,row.id).changes!==1)throw new ApiError(409,'메일 상태가 변경됐습니다. 새로 확인하세요.');
      db.prepare("INSERT OR IGNORE INTO mail_messages(id,owner_session_id,living_task_id,message_id,thread_id,direction,from_address,to_address,subject,body,auth_json,workflow_id,created_at) VALUES (?,?,?,?,?,'OUTBOUND','',?,?,?,'{}',?,?)").run(randomUUID(),actor.sessionId,taskId,result.messageId,draft.threadId,draft.to,draft.subject,draft.body,row.workflow_id,now);
      const nodes=db.prepare('SELECT id,action_type FROM workflow_nodes WHERE workflow_id=?').all(row.workflow_id) as Array<{id:string;action_type:string}>;
      // The backend constructs a single-step mail episode. Never mark unrelated actions done.
      if(nodes.length===1&&nodes[0].action_type==='external.email.send'){
        const evidence={sent:true,messageId:result.messageId,remoteVerified:true,externalEffect:'ACTUAL',reconciled:true,resent:false};
        db.prepare("UPDATE workflow_nodes SET status='VERIFIED',error_message=NULL,result_json=?,finished_at=? WHERE workflow_id=? AND id=?").run(JSON.stringify({toolResult:{ok:true,sent:true,externalSideEffect:true,externalEffect:'ACTUAL',reversible:false,filesCreated:[],dataRead:[],fieldsRead:[],fieldsExcluded:[],evidence}}),now,row.workflow_id,nodes[0].id);
        db.prepare('INSERT INTO verifications(id,workflow_id,node_id,passed,verifier_version,evidence_json,created_at) VALUES (?,?,?,1,?,?,?)').run(randomUUID(),row.workflow_id,nodes[0].id,'gmail-readback-v1',JSON.stringify(evidence),now);
        db.prepare("UPDATE workflows SET status='COMPLETED',error_code=NULL,error_message=NULL,version=version+1,updated_at=? WHERE id=?").run(now,row.workflow_id);
        db.prepare("UPDATE living_tasks SET status='WAITING_EVENT',waiting_reason='발송 결과를 확인했습니다. 완료 조건 또는 다음 답장을 확인하세요.',version=version+1,updated_at=? WHERE id=? AND owner_session_id=? AND current_workflow_id=? AND status='BLOCKED'").run(now,taskId,actor.sessionId,row.workflow_id);
      }
      const details={outboxId:row.id,messageId:result.messageId,resent:false};
      recordActivity(db,actor.sessionId,taskId,'MAIL_RECONCILED',details);
      db.prepare('INSERT INTO recorder_events(id,workflow_id,event_type,event_json,created_at) VALUES (?,?,?,?,?)').run(randomUUID(),row.workflow_id,'MAIL_RECONCILED',JSON.stringify({eventType:'MAIL_RECONCILED',verificationStatus:'VERIFIED',externalEffect:'ACTUAL',details}),now);
      return {verified:true,message:'Gmail 보낸편지함의 내용과 첨부파일을 확인했습니다. 다시 발송하지 않았습니다.'};
    })();
  });
}
