import { getRuntime } from "@/lib/api/runtime";
import { apiFailure, json, ApiError } from "@/lib/api/responses";
import { assertTaskAccess } from "@/lib/api/task-access";
import { resolveSessionActor } from "@/lib/security/session";
import { GoalContracts } from "@/lib/tasks/goal-contract";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveSessionActor(request), { id } = await params, app = getRuntime();
    assertTaskAccess(app.db, id, actor);
    const task = app.tasks.get(id, actor);
    if (!task) throw new ApiError(404, "작업을 찾을 수 없습니다.");
    const project = task.projectId ? app.projects.get(task.projectId, actor.sessionId) : null;
    const workflows = app.db.prepare(`SELECT id,living_task_id AS livingTaskId,source_name AS sourceName,status,
      (SELECT kind FROM approvals WHERE workflow_id=workflows.id AND status='PENDING' LIMIT 1) AS pendingKind,
      execution_mode AS executionMode,pre_execution_enabled AS preExecutionEnabled,provider_json AS provider,created_at AS createdAt,updated_at AS updatedAt
      FROM workflows WHERE owner_session_id=? AND living_task_id=? ORDER BY created_at DESC,rowid DESC`).all(actor.sessionId, id);
    const artifacts = app.db.prepare(`SELECT a.id,a.workflow_id AS workflowId,a.display_name AS displayName,a.state,a.verification_status AS verificationStatus
      FROM artifacts a JOIN workflows w ON w.id=a.workflow_id WHERE w.owner_session_id=? AND w.living_task_id=? ORDER BY a.created_at DESC,a.rowid DESC`).all(actor.sessionId, id);
    const inbound=app.db.prepare("SELECT subject FROM mail_messages WHERE owner_session_id=? AND living_task_id=? AND direction='INBOUND' ORDER BY rowid DESC LIMIT 1").get(actor.sessionId,id) as {subject:string}|undefined;
    const hasInboundEmail = Boolean(app.db.prepare("SELECT 1 FROM mail_messages WHERE owner_session_id=? AND living_task_id=? AND direction='INBOUND' LIMIT 1").get(actor.sessionId, id));
    const outbox = app.db.prepare('SELECT workflow_id,status,result_json FROM mail_outbox WHERE owner_session_id=? AND living_task_id=? ORDER BY rowid DESC LIMIT 1').get(actor.sessionId, id) as {workflow_id:string;status:string;result_json:string|null}|undefined;
    let externalEffect: 'SIMULATED' | 'ACTUAL' | null = null;
    if (outbox?.status === 'SENT' && outbox.result_json) {
      try { const receipt = JSON.parse(outbox.result_json) as { externalEffect?: string }; if (receipt.externalEffect === 'SIMULATED' || receipt.externalEffect === 'ACTUAL') externalEffect = receipt.externalEffect; } catch { /* No verified receipt: never claim delivery. */ }
    }
    return json({ task, project, workflows, artifacts, hasInboundEmail, inboundSubject:inbound?.subject??null, goalContract:new GoalContracts(app.db).view(id,actor.sessionId), latestReply: outbox ? {workflowId:outbox.workflow_id,status:outbox.status,externalEffect} : null });
  } catch (error) { return apiFailure(error); }
}
