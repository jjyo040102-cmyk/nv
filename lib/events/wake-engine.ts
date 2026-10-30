import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { WakeInput,WakeResult } from './types';
import { EventRepository } from './repository';
import { withTaskLease,assertTaskLease,TaskConflictError } from '../tasks/lease';
import { recordActivity } from '../audit/activity';
import { getDomainErrorKind } from '../domain/errors';
export class WakeEngine{
  private resumeHandler?:(taskId:string,ownerSessionId:string,wakeEventId:string)=>Promise<void>;
  constructor(private readonly db:Database.Database,private readonly events=new EventRepository(db)){}
  setResumeHandler(handler:(taskId:string,ownerSessionId:string,wakeEventId:string)=>Promise<void>):void{this.resumeHandler=handler;}
  async ingest(input:WakeInput):Promise<WakeResult>{
    const recorded=this.events.recordEvent(input),event=recorded.event;
    if(recorded.duplicate&&event.status==='PROCESSED')return {event,duplicate:true,woke:false,reason:'duplicate'};
    if(recorded.duplicate&&event.status==='FAILED')return {event,duplicate:true,woke:false,reason:'failed-needs-review'};
    const worker=`wake:${randomUUID()}`;
    if(!this.events.claimEvent(event.id,worker))return {event:this.events.getEvent(event.id)!,duplicate:recorded.duplicate,woke:false,reason:'already-processing'};
    let entered=false;
    try{return await withTaskLease(this.db,event.livingTaskId,event.ownerSessionId,async()=>{
      entered=true;
      const task=this.db.prepare('SELECT status,current_workflow_id FROM living_tasks WHERE id=? AND owner_session_id=?').get(event.livingTaskId,event.ownerSessionId) as {status:string;current_workflow_id:string|null}|undefined;
      if(!task)throw new Error('Task not found');
      if(['CANCELLED','COMPLETED','WAITING_APPROVAL','BLOCKED','PAUSED'].includes(task.status)){
        // Terminal tasks consume ordinary events; protected nonterminal tasks retain them until released.
        if (['CANCELLED','COMPLETED'].includes(task.status)) this.events.finishEvent(event.id,worker);
        else this.events.deferEvent(event.id,worker,`Protected task: ${task.status}`);
        if (!recorded.duplicate) recordActivity(this.db,event.ownerSessionId,event.livingTaskId,'WAKE_PROTECTED',{wakeEventId:event.id,status:task.status});
        return {event:this.events.getEvent(event.id)!,duplicate:recorded.duplicate,woke:false,reason:`protected:${task.status}`};
      }
      if(task.current_workflow_id){
        const workflow=this.db.prepare('SELECT status FROM workflows WHERE id=?').get(task.current_workflow_id) as {status:string}|undefined;
        if(workflow?.status==='RUNNING'){
          this.db.prepare("UPDATE living_tasks SET status='BLOCKED',waiting_reason='중단된 실행의 실제 결과를 확인해야 합니다.',version=version+1,updated_at=? WHERE id=? AND owner_session_id=?")
            .run(new Date().toISOString(),event.livingTaskId,event.ownerSessionId);
          throw new TaskConflictError('Interrupted workflow requires outcome review');
        }
      }
      this.db.prepare("UPDATE living_tasks SET status='READY',waiting_reason=NULL,version=version+1,updated_at=? WHERE id=? AND owner_session_id=?")
        .run(new Date().toISOString(),event.livingTaskId,event.ownerSessionId);
      recordActivity(this.db,event.ownerSessionId,event.livingTaskId,'WAKE_STARTED',{wakeEventId:event.id,type:event.type});
      if(this.resumeHandler)await this.resumeHandler(event.livingTaskId,event.ownerSessionId,event.id);
      assertTaskLease(this.db,event.livingTaskId);this.events.finishEvent(event.id,worker);
      recordActivity(this.db,event.ownerSessionId,event.livingTaskId,'WAKE_PROCESSED',{wakeEventId:event.id});
      return {event:this.events.getEvent(event.id)!,duplicate:recorded.duplicate,woke:true};
    });}catch(error){
      if(!entered&&getDomainErrorKind(error)==='TASK_CONFLICT'){this.events.deferEvent(event.id,worker);return {event:this.events.getEvent(event.id)!,duplicate:recorded.duplicate,woke:false,reason:'lease'};}
      this.events.failEvent(event.id,error instanceof Error?error.name:'WakeError',worker);
      recordActivity(this.db,event.ownerSessionId,event.livingTaskId,'WAKE_FAILED',{wakeEventId:event.id,errorType:error instanceof Error?error.name:'WakeError'});throw error;
    }
  }
  async recoverInterruptedEvents(now=new Date(),thresholdMs=5*60_000):Promise<number>{
    const before=new Date(now.getTime()-thresholdMs).toISOString();
    return this.db.transaction(()=>{
      const rows=this.db.prepare("SELECT id,owner_session_id,living_task_id FROM wake_events WHERE status='PROCESSING' AND claimed_at<? AND NOT EXISTS(SELECT 1 FROM living_tasks t WHERE t.id=wake_events.living_task_id AND t.lease_owner IS NOT NULL AND t.lease_expires_at>?)").all(before,new Date().toISOString()) as Array<{id:string;owner_session_id:string;living_task_id:string}>;
      const count=this.events.resetStaleProcessing(before);
      for(const row of rows)recordActivity(this.db,row.owner_session_id,row.living_task_id,'WAKE_RECOVERED',{wakeEventId:row.id});return count;
    })();
  }
  async processPendingEvents(limit=100):Promise<number>{
    let processed=0;
    for(const event of this.events.listPendingEvents(limit)){
      const trigger=this.events.getTrigger(event.triggerId);if(!trigger?.enabled)continue;
      try{const result=await this.ingest({triggerId:event.triggerId,ownerSessionId:event.ownerSessionId,eventKey:event.eventKey,type:event.type,payloadJson:event.payloadJson});if(result.woke||result.event.status==='PROCESSED')processed++;}
      catch{/* Failed events require review; no tight automatic retry loop. */}
    }return processed;
  }
}
