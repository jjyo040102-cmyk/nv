import { getRuntime } from "@/lib/api/runtime";
import { apiFailure, json } from "@/lib/api/responses";
import { createWorkflowFromUpload } from "@/lib/api/upload";
import { resolveSessionActor } from "@/lib/security/session";

export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await resolveSessionActor(request);
    const result = await createWorkflowFromUpload(request, getRuntime(), actor.sessionId);
    return json({ workflow: { ...result.workflow, sourcePath: null, sourceText: undefined }, source: result.source }, 201);
  } catch (error) { return apiFailure(error); }
}
export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await resolveSessionActor(request);
    const { db } = getRuntime();
    const workflows = db.prepare("SELECT id,living_task_id AS livingTaskId,source_name AS sourceName,status,(SELECT kind FROM approvals WHERE workflow_id=workflows.id AND status='PENDING' LIMIT 1) AS pendingKind,execution_mode AS executionMode,pre_execution_enabled AS preExecutionEnabled,provider_json AS provider,created_at AS createdAt,updated_at AS updatedAt FROM workflows WHERE owner_session_id=? ORDER BY created_at DESC LIMIT 100").all(actor.sessionId);
    return json({ workflows });
  } catch (error) { return apiFailure(error); }
}
