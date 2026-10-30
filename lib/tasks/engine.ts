import { createHash } from 'node:crypto';
import { isProviderError } from '../providers/errors';
import { reconcileTaskFromWorkflow } from './lifecycle';
import { bindEpisodeContext, getEpisodeContext } from './episode-context';
import type Database from 'better-sqlite3';
import type {SessionActor} from '../domain/types';
import type {WorkflowEngine,WorkflowSnapshot} from '../workflow/engine';
import {LivingTaskRepository} from './repository';
import {ProjectRepository} from './project-repository';
import type {LivingTaskRecord,ProjectRecord} from './types';
import type {TaskPlanner,PlanResult} from './planner';
import {withTaskLease,TaskConflictError} from './lease';
import {recordActivity} from '../audit/activity';
import {GoalContracts} from './goal-contract';
export class LivingTaskEngine{
  private readonly tasks:LivingTaskRepository;private readonly projects:ProjectRepository;
  constructor(private readonly db:Database.Database,private readonly workflows:WorkflowEngine,private readonly planner:TaskPlanner){this.tasks=new LivingTaskRepository(db);this.projects=new ProjectRepository(db);}
  createProject(input:{name:string;summary?:string},actor:SessionActor):ProjectRecord{return this.projects.create({ownerSessionId:actor.sessionId,...input});}
  createGoal(input:{title:string;goal:string;projectId?:string|null;backgroundWatchEnabled?:boolean;speculativePreparationEnabled?:boolean;sourceWorkflowId?:string;requestId?:string},actor:SessionActor):LivingTaskRecord{
    const requestHash=createHash('sha256').update(JSON.stringify({title:input.title,goal:input.goal,projectId:input.projectId??null,backgroundWatchEnabled:input.backgroundWatchEnabled??false,speculativePreparationEnabled:input.speculativePreparationEnabled??false,sourceWorkflowId:input.sourceWorkflowId??null})).digest('hex');
    if(input.requestId&&!/^[0-9a-f-]{36}$/i.test(input.requestId))throw new TaskConflictError('잘못된 요청 식별자입니다.');
    return this.db.transaction(() => {
      if(input.requestId){
        const previous=this.db.prepare('SELECT task_id,request_hash FROM task_creation_requests WHERE owner_session_id=? AND request_id=?').get(actor.sessionId,input.requestId) as {task_id:string;request_hash:string}|undefined;
        if(previous){
          if(previous.request_hash!==requestHash)throw new TaskConflictError('같은 요청 식별자로 다른 작업을 만들 수 없습니다.');
          const existing=this.tasks.get(previous.task_id,actor.sessionId);if(!existing)throw new TaskConflictError('기존 요청의 작업을 찾지 못했습니다.');
          return existing;
        }
      }
      if (input.sourceWorkflowId) {
        const source = this.db.prepare('SELECT owner_session_id,living_task_id,status FROM workflows WHERE id=?').get(input.sourceWorkflowId) as {owner_session_id:string;living_task_id:string|null;status:string}|undefined;
        if (!source || source.owner_session_id !== actor.sessionId || source.living_task_id || source.status !== 'DRAFT') throw new TaskConflictError('본인이 업로드한 아직 실행하지 않은 문서만 연결할 수 있습니다.');
      }
      const task=this.tasks.create({ownerSessionId:actor.sessionId,...input,status:'READY',executionMode:input.speculativePreparationEnabled?'PRE_EXECUTION':'MANUAL'});
      new GoalContracts(this.db).create(task.id,actor.sessionId,input.goal);
      if (input.sourceWorkflowId) {
        this.tasks.linkWorkflow(task.id, input.sourceWorkflowId, actor.sessionId);
        bindEpisodeContext(this.db, {workflowId:input.sourceWorkflowId,taskId:task.id,ownerSessionId:actor.sessionId,isDocumentSource:true});
      }
      if(input.requestId)this.db.prepare('INSERT INTO task_creation_requests(owner_session_id,request_id,request_hash,task_id,created_at) VALUES (?,?,?,?,?)').run(actor.sessionId,input.requestId,requestHash,task.id,new Date().toISOString());
      recordActivity(this.db,actor.sessionId,task.id,'TASK_CREATED',{sourceWorkflowId:input.sourceWorkflowId??null});
      return this.tasks.get(task.id,actor.sessionId)!;
    })();
  }
  get(taskId:string,actor:SessionActor):LivingTaskRecord|null{return this.tasks.get(taskId,actor.sessionId);}
  list(actor:SessionActor):LivingTaskRecord[]{return this.tasks.list(actor.sessionId);}
  planNext(taskId:string,actor:SessionActor,wakeEventId?:string):Promise<PlanResult>{return this.planner.planNext({taskId,actor,wakeEventId});}
  executeCurrent(taskId:string,actor:SessionActor):Promise<LivingTaskRecord>{return withTaskLease(this.db,taskId,actor.sessionId,async()=>{
    let result:LivingTaskRecord;
    for(;;){
    try{result=await this.executeEpisode(taskId,actor);break;}
    catch(error){
      const task=this.tasks.get(taskId,actor.sessionId)!;
      const enabled=(this.db.prepare('SELECT retry_failed_steps_enabled FROM settings WHERE id=1').get() as {retry_failed_steps_enabled:number}).retry_failed_steps_enabled===1;
      const failed=task.currentWorkflowId?this.workflows.getSnapshot(task.currentWorkflowId):null;
      const repairCount=(this.db.prepare('SELECT COUNT(*) AS count FROM task_repairs WHERE living_task_id=?').get(taskId) as {count:number}).count;
      const safe=failed&&failed.workflow.status==='FAILED'&&['TOOL_FAILED','PREPARATION_FAILED'].includes(failed.workflow.errorCode??'')&&failed.nodes.some(node=>node.status==='FAILED'&&node.actionType.startsWith('artifact.'))&&failed.nodes.every(node=>['employee.lookup','artifact.xlsx.participants','artifact.docx.response','workflow.complete','expense.process'].includes(node.actionType));
      if(!safe||task.status!=='FAILED')throw error;
      const recovered=await this.workflows.compensateFailedEpisode(failed!.workflow.id,actor);
      if(recovered.status!=='ROLLED_BACK'||!enabled||repairCount>=1)throw error;
      if(this.db.prepare('INSERT OR IGNORE INTO task_repairs(failed_workflow_id,living_task_id,created_at) VALUES (?,?,?)').run(failed!.workflow.id,taskId,new Date().toISOString()).changes!==1)throw error;
      recordActivity(this.db,actor.sessionId,taskId,'VERIFICATION_REPLAN',{failedWorkflowId:failed!.workflow.id,recoveredFiles:recovered.deleted.length,maximumRepairs:1});
    }
    }
    const settings=this.db.prepare('SELECT automation_profile,auto_continue_enabled FROM settings WHERE id=1').get() as {automation_profile:string;auto_continue_enabled:number};
    if(settings.automation_profile!=='AUTOMATIC'||settings.auto_continue_enabled!==1)return result;
    for(let count=1;count<3;count++){
      if(result.status!=='READY'||!result.currentWorkflowId)break;
      const current=this.workflows.getSnapshot(result.currentWorkflowId);
      if(current.workflow.status!=='COMPLETED'||current.workflow.analysis?.taskOutcome?.status!=='CONTINUE'||getEpisodeContext(this.db,current.workflow.id,actor.sessionId)?.reply_status==='PENDING')break;
      recordActivity(this.db,actor.sessionId,taskId,'BOUNDED_AUTO_CONTINUE',{completedWorkflowId:current.workflow.id,episodeNumber:count+1});
      result=await this.executeEpisode(taskId,actor);
    }
    if(result.status==='READY'&&result.currentWorkflowId&&this.workflows.getSnapshot(result.currentWorkflowId).workflow.analysis?.taskOutcome?.status==='CONTINUE'){
      result=this.tasks.update(taskId,actor.sessionId,result.version,{waitingReason:'이번 실행에서 최대 3개 실행 단계를 처리했습니다. 계속 진행을 누르거나 다음 이벤트를 기다리세요.'});
      recordActivity(this.db,actor.sessionId,taskId,'AUTO_CONTINUE_LIMIT',{maximumEpisodes:3});
    }
    return result;
  });}
  private executeEpisode(taskId:string,actor:SessionActor):Promise<LivingTaskRecord>{return withTaskLease(this.db,taskId,actor.sessionId,async()=>{
    let task=this.tasks.get(taskId,actor.sessionId)!;
    if(['CANCELLED','COMPLETED'].includes(task.status))throw new TaskConflictError('Task is terminal');
    if(['PAUSED','BLOCKED','WAITING_APPROVAL','RUNNING'].includes(task.status))throw new TaskConflictError('현재 작업 상태에서는 실행할 수 없습니다. 승인 또는 상태 확인이 필요합니다.');
    if (task.currentWorkflowId && this.workflows.getSnapshot(task.currentWorkflowId).workflow.status === 'COMPLETED' && getEpisodeContext(this.db, task.currentWorkflowId, actor.sessionId)?.reply_status === 'PENDING') {
      await this.workflows.finalizeCompletedEpisode(task.currentWorkflowId, actor);
      return this.tasks.get(taskId, actor.sessionId)!;
    }
    if (task.currentWorkflowId && this.workflows.getSnapshot(task.currentWorkflowId).workflow.status === 'FAILED') {
      const failed = this.workflows.getSnapshot(task.currentWorkflowId);
      if(failed.nodes.length===1&&failed.nodes[0].actionType==='external.email.send'&&this.db.prepare("SELECT 1 FROM mail_outbox WHERE workflow_id=? AND status='READY'").get(task.currentWorkflowId)){
        return this.evaluateAfterWorkflow(taskId,actor,await this.workflows.restoreUnsentMailApproval(task.currentWorkflowId,actor));
      }
      const safeActions = new Set(['employee.lookup','artifact.xlsx.participants','artifact.docx.response','workflow.complete','expense.process']);
      if (failed.workflow.errorCode === 'DECISION_REJECTED' || failed.nodes.some(node => !safeActions.has(node.actionType)) || failed.workflow.errorCode === 'INTERRUPTED_OUTCOME_UNKNOWN') {
        throw new TaskConflictError('거절되었거나 외부 실행 결과가 불확실한 작업은 자동 재실행하지 않습니다. 기록을 확인하세요.');
      }
      // Explicit retry keeps failed history and artifacts; a new episode uses the same ownership and policy boundary.
      await this.planNext(taskId,actor); task=this.tasks.get(taskId,actor.sessionId)!;
    }
    if(!task.currentWorkflowId||['DRAFT','COMPLETED'].includes(this.workflows.getSnapshot(task.currentWorkflowId).workflow.status)){
      await this.planNext(taskId,actor);task=this.tasks.get(taskId,actor.sessionId)!;
    }
    const before=this.workflows.getSnapshot(task.currentWorkflowId!);
    if(before.workflow.ownerSessionId!==actor.sessionId||before.workflow.livingTaskId!==taskId)throw new TaskConflictError('작업 실행 범위가 일치하지 않습니다.');
    if(before.workflow.status==='RUNNING')throw new TaskConflictError('이전 실행 결과가 확정되지 않았습니다.');
    if(!['ANALYZED','PAUSED'].includes(before.workflow.status))return this.evaluateAfterWorkflow(taskId,actor,before);
    this.tasks.update(taskId,actor.sessionId,task.version,{status:'RUNNING'});
    recordActivity(this.db,actor.sessionId,taskId,'TASK_EXECUTION_STARTED',{workflowId:task.currentWorkflowId});
    try{
      const snapshot=before.workflow.status==='PAUSED'?await this.workflows.resumeWorkflow(task.currentWorkflowId!,actor):await this.workflows.executeWorkflow(task.currentWorkflowId!,actor);
      return this.evaluateAfterWorkflow(taskId,actor,snapshot);
    }catch(error){
      const current=this.tasks.get(taskId,actor.sessionId)!;
      if(current.status==='RUNNING')this.tasks.update(taskId,actor.sessionId,current.version,{status:'FAILED',waitingReason:'실행에 실패했습니다. 작업 기록과 실제 결과를 확인하세요.'});
      recordActivity(this.db,actor.sessionId,taskId,'TASK_EXECUTION_FAILED',{errorType:error instanceof Error?error.name:'UnknownError'});throw error;
    }
  });}
  evaluateAfterWorkflow(taskId:string,actor:SessionActor,snapshot?:WorkflowSnapshot):LivingTaskRecord{
    const task=this.tasks.get(taskId,actor.sessionId);if(!task)throw new Error('Task not found');
    const snap=snapshot??(task.currentWorkflowId?this.workflows.getSnapshot(task.currentWorkflowId):null);
    if(!snap)return task;
    if(snap.workflow.ownerSessionId!==actor.sessionId||snap.workflow.livingTaskId!==taskId)throw new TaskConflictError('다른 작업의 실행 결과입니다.');
    return reconcileTaskFromWorkflow(this.db,snap)??task;
  }

  pause(taskId:string,actor:SessionActor):LivingTaskRecord{
    const task=this.tasks.get(taskId,actor.sessionId);if(!task)throw new Error('Task not found');
    if(['CANCELLED','COMPLETED'].includes(task.status))throw new TaskConflictError('Task is terminal');if(task.status==='PAUSED')return task;
    // A running tool is not falsely reported cancelled; subsequent tool boundaries stop.
    if(task.currentWorkflowId&&['ANALYZED','WAITING'].includes(this.workflows.getSnapshot(task.currentWorkflowId).workflow.status))this.workflows.pauseWorkflow(task.currentWorkflowId,actor);
    const current=this.tasks.get(taskId,actor.sessionId)!;const updated=current.status==='PAUSED'?current:this.tasks.update(taskId,actor.sessionId,current.version,{status:'PAUSED'});recordActivity(this.db,actor.sessionId,taskId,'TASK_PAUSED');return updated;
  }
  resume(taskId:string,actor:SessionActor):Promise<LivingTaskRecord>{return withTaskLease(this.db,taskId,actor.sessionId,async()=>{
    const task=this.tasks.get(taskId,actor.sessionId)!;if(task.status!=='PAUSED')throw new TaskConflictError('Task is not paused');
    const next=this.tasks.update(taskId,actor.sessionId,task.version,{status:'READY'});recordActivity(this.db,actor.sessionId,taskId,'TASK_RESUMED');
    if(!next.currentWorkflowId)return next;
    let snapshot=this.workflows.getSnapshot(next.currentWorkflowId);
    if(snapshot.workflow.status==='RUNNING'){
      snapshot=await this.workflows.recoverInterruptedExecution(next.currentWorkflowId,actor);
      const recovered=this.tasks.get(taskId,actor.sessionId)!;
      if(recovered.status==='BLOCKED')return recovered;
      if(recovered.status==='PAUSED')this.tasks.update(taskId,actor.sessionId,recovered.version,{status:'READY'});
    }
    if(snapshot.workflow.status==='PAUSED')return this.evaluateAfterWorkflow(taskId,actor,await this.workflows.resumeWorkflow(next.currentWorkflowId,actor));
    if(snapshot.workflow.status==='COMPLETED'){
      await this.workflows.finalizeCompletedEpisode(next.currentWorkflowId,actor);return this.tasks.get(taskId,actor.sessionId)!;
    }
    return this.evaluateAfterWorkflow(taskId,actor,snapshot);
  });}
  cancel(taskId:string,actor:SessionActor):LivingTaskRecord{
    const task=this.tasks.get(taskId,actor.sessionId);if(!task)throw new Error('Task not found');if(task.status==='CANCELLED')return task;
    if(task.status==='COMPLETED')throw new TaskConflictError('Task is terminal');
    const updated=this.tasks.update(taskId,actor.sessionId,task.version,{status:'CANCELLED',waitingReason:null,completedAt:new Date().toISOString()});recordActivity(this.db,actor.sessionId,taskId,'TASK_CANCELLED');return updated;
  }
  async handleWake(taskId:string,actor:SessionActor,wakeEventId:string):Promise<LivingTaskRecord>{
    const task=this.tasks.get(taskId,actor.sessionId);if(!task)throw new Error('Task not found');if(['CANCELLED','COMPLETED','WAITING_APPROVAL','BLOCKED','PAUSED'].includes(task.status))return task;
    const settings=this.db.prepare('SELECT automation_profile,auto_continue_enabled,replan_on_new_info_enabled,retry_failed_steps_enabled FROM settings WHERE id=1').get() as {automation_profile:string;auto_continue_enabled:number;replan_on_new_info_enabled:number;retry_failed_steps_enabled:number};
    if(settings.replan_on_new_info_enabled!==1&&task.currentWorkflowId&&this.workflows.getSnapshot(task.currentWorkflowId).workflow.status==='COMPLETED'){
      return this.tasks.update(taskId,actor.sessionId,task.version,{status:'WAITING_EVENT',waitingReason:'새 정보가 도착했습니다. 자동 재계획이 꺼져 있어 계속 진행을 기다립니다.'});
    }
    if(settings.replan_on_new_info_enabled===1||!task.currentWorkflowId){
      try{await this.planNext(taskId,actor,wakeEventId);}
      catch(error){
        // At most one persisted retry, before any work tool. Invalid-output repair is already bounded by the provider.
        const retry=settings.retry_failed_steps_enabled===1&&isProviderError(error)&&error.retryable&&error.code==='CONNECTION_FAILED';
        if(!retry||this.db.prepare('UPDATE wake_events SET planning_retries=planning_retries+1 WHERE id=? AND owner_session_id=? AND living_task_id=? AND planning_retries<1').run(wakeEventId,actor.sessionId,taskId).changes!==1)throw error;
        recordActivity(this.db,actor.sessionId,taskId,'SAFE_PLAN_RETRY',{wakeEventId,retryCount:1});
        await new Promise(resolve=>setTimeout(resolve,250));
        await this.planNext(taskId,actor,wakeEventId);
      }
    }
    if(settings.automation_profile==='AUTOMATIC'&&settings.auto_continue_enabled===1){const current=this.tasks.get(taskId,actor.sessionId)!;if(!['WAITING_APPROVAL','BLOCKED','PAUSED','CANCELLED','COMPLETED'].includes(current.status))return this.executeCurrent(taskId,actor);}
    return this.tasks.get(taskId,actor.sessionId)!;
  }
}
