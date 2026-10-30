import { createRoutedProvider } from "@/lib/providers/router";
import { AnalyzeRequestSchema, readJson, WorkflowIdSchema } from "@/lib/api/schemas";
import { getRuntime } from "@/lib/api/runtime";
import { ApiError, apiFailure, json, publicSnapshot } from "@/lib/api/responses";
import { createWorkflowAnalyzer } from "@/lib/providers/registry";
import { resolveSessionActor } from "@/lib/security/session";
import { assertWorkflowAccess } from "@/lib/api/access";
import { getTestFault, recordTestAttempt } from "@/lib/testing/faults";
import { analyzeStructuredText } from "@/lib/providers/provider";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const actor = await resolveSessionActor(request);
    const { id } = await context.params; WorkflowIdSchema.parse(id);
    const runtime = getRuntime();
    assertWorkflowAccess(runtime, id, actor);
    const workflow = runtime.repo.getWorkflow(id);
    if (!workflow) throw new ApiError(404, "워크플로를 찾을 수 없습니다.");
    const input = AnalyzeRequestSchema.parse(await readJson(request));
    if (workflow.status !== "DRAFT") {
      if (workflow.status === "ANALYZED" && workflow.analysis) {
        const snapshot = publicSnapshot(runtime.engine.getSnapshot(id));
        return json({ snapshot, workflow: snapshot.workflow, graph: { nodes: snapshot.nodes, edges: snapshot.edges }, facts: snapshot.workflow.analysis?.facts, executedActions: 0,
          message: "아직 실행된 작업이 없습니다.", providerMode: snapshot.workflow.provider?.mode, realModelCalled: snapshot.workflow.provider?.realModelCalled });
      }
      throw new ApiError(409, "이미 처리 중인 워크플로입니다.");
    }
    const settings = runtime.repo.getSettings();
    const mode = input.executionMode ?? settings.executionMode;
    const preExecutionEnabled = input.preExecutionEnabled ?? settings.preExecutionEnabled;
    if ((mode === "PRE_EXECUTION") !== preExecutionEnabled) throw new ApiError(400, "사전 실행 모드와 설정이 일치하지 않습니다.");
    const task=workflow.livingTaskId?runtime.taskRepo.get(workflow.livingTaskId,actor.sessionId):null;
    const provider = createRoutedProvider({ db: runtime.db, credentials: runtime.credentials, ownerSessionId: actor.sessionId, taskId: task?.id });
    // Each owner uses their saved Nebius configuration; no request-level model override.
    const analyzer = getTestFault(id) === "malformed-provider" ? async () => analyzeStructuredText({ provider: provider.id, model: provider.model, mode: provider.id === "demo" ? "demo" : "real", realModelCalled: provider.id !== "demo" }, async () => { recordTestAttempt(id); return "{invalid JSON"; }) : createWorkflowAnalyzer(provider);
    const analyzed = await runtime.engine.analyzeWorkflow(id, analyzer, { executionMode: mode, preExecutionEnabled });
    const snapshot = publicSnapshot(analyzed.snapshot);
    return json({ snapshot, workflow: snapshot.workflow, graph: { nodes: snapshot.nodes, edges: snapshot.edges }, facts: snapshot.workflow.analysis?.facts, executedActions: 0, message: analyzed.message,
      providerMode: analyzed.snapshot.workflow.provider?.mode, realModelCalled: analyzed.snapshot.workflow.provider?.realModelCalled });
  } catch (error) { return apiFailure(error); }
}
