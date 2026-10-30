import type Database from 'better-sqlite3';
import type { WorkflowSnapshot } from '../workflow/engine';
import { recordActivity } from '../audit/activity';
import { LivingTaskRepository } from './repository';
import type { LivingTaskRecord, LivingTaskStatus } from './types';
import { GoalContracts } from './goal-contract';

/** One reconciliation path for task execution, legacy workflow routes and approval decisions.
 * Stale episode snapshots cannot overwrite the current episode or an explicit user stop.
 * A completed workflow is verified work, not by itself a claim that a watched goal has ended.
 */
export function reconcileTaskFromWorkflow(db: Database.Database, snapshot: WorkflowSnapshot): LivingTaskRecord | null {
  const workflow = snapshot.workflow;
  if (!workflow.livingTaskId) return null;
  const repo = new LivingTaskRepository(db);
  const task = repo.get(workflow.livingTaskId, workflow.ownerSessionId);
  if (!task || task.currentWorkflowId !== workflow.id) return task;
  if (['PAUSED', 'CANCELLED', 'COMPLETED', 'BLOCKED'].includes(task.status)) return task;
  let status: LivingTaskStatus = task.status;
  let waitingReason = task.waitingReason, completedAt = task.completedAt;
  if (workflow.status === 'FAILED') {
    status = 'FAILED';
    waitingReason = workflow.errorCode === 'DECISION_REJECTED'
      ? '요청을 거절했습니다. 실행 기록과 임시 결과 정리를 확인하세요.'
      : '실행에 실패했습니다. 확인된 결과는 보존했으며 자동으로 반복 실행하지 않습니다.';
  } else if (workflow.status === 'WAITING') {
    const blocked = snapshot.nodes.some(node => node.status === 'BLOCKED');
    const approval = snapshot.approvals.some(item => item.status === 'PENDING');
    status = blocked ? 'BLOCKED' : approval ? 'WAITING_APPROVAL' : 'WAITING_EVENT';
    waitingReason = blocked ? '보안 또는 실행 정책으로 차단됨' : approval ? '사용자 승인 대기' : '새로운 정보 대기';
  } else if (workflow.status === 'PAUSED') {
    status = 'PAUSED';
    waitingReason = task.waitingReason ?? '사용자가 실행을 일시정지했습니다.';
  } else if (workflow.status === 'COMPLETED') {
    // A persisted reply proposal must be handed to EmailService, never to an LLM-created send tool.
    const episode = db.prepare('SELECT reply_status FROM task_episode_context WHERE workflow_id=? AND living_task_id=? AND owner_session_id=?')
      .get(workflow.id, task.id, task.ownerSessionId) as { reply_status: string } | undefined;
    const outcome = workflow.analysis?.taskOutcome;
    if (episode?.reply_status === 'PENDING') {
      status = 'READY'; waitingReason = '검증한 결과로 답장을 준비하고 있습니다.';
    } else if (outcome?.status === 'CONTINUE') {
      status = 'READY'; waitingReason = outcome.reason;
    } else if (outcome?.status === 'WAIT') {
      status = 'WAITING_EVENT'; waitingReason = outcome.reason;
    } else {
      const hasTrigger = Boolean(db.prepare('SELECT 1 FROM trigger_subscriptions WHERE living_task_id=? AND owner_session_id=? AND enabled=1 LIMIT 1').get(task.id, task.ownerSessionId));
      // Explicit COMPLETE requires verified referenced steps and cannot disable a user-configured watch.
      if (new GoalContracts(db).exists(task.id,task.ownerSessionId)) {
        status = 'WAITING_EVENT'; waitingReason = task.backgroundWatchEnabled || hasTrigger ? '다음 이벤트를 기다립니다. 목표를 달성했다면 결과를 확인하고 완료하세요.' : '실행 결과가 준비됐습니다. 완료 조건을 확인하세요.';
      } else if (task.backgroundWatchEnabled || hasTrigger) {
        status = 'WAITING_EVENT'; waitingReason = '새로운 정보 또는 이벤트 대기';
      } else {
        status = 'COMPLETED'; waitingReason = null; completedAt = new Date().toISOString();
      }
    }
  }
  if (status === task.status && waitingReason === task.waitingReason && completedAt === task.completedAt) return task;
  const updated = repo.update(task.id, task.ownerSessionId, task.version, { status, waitingReason, completedAt });
  recordActivity(db, task.ownerSessionId, task.id, 'TASK_STATE_CHANGED', { status, workflowId: workflow.id });
  return updated;
}
