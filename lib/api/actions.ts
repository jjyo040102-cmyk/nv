import { z } from "zod";
import { AuthorizationError } from "../auth/roles";
import { WorkflowIdSchema, readJson } from "./schemas";
import { ApiError, apiFailure, json, publicSnapshot } from "./responses";
import { getRuntime } from "./runtime";
import { resolveSessionActor } from "../security/session";
import { assertWorkflowAccess } from "./access";

const DecisionSchema = z.object({ actor: z.string().min(1), expectedVersion: z.number().int().nonnegative() }).strict();
export async function workflowAction(request: Request, context: { params: Promise<{ id: string }> }, action: "execute" | "pause" | "resume" | "discard") {
  try {
    const actor = await resolveSessionActor(request);
    const { id } = await context.params; WorkflowIdSchema.parse(id);
    const app = getRuntime(); assertWorkflowAccess(app, id, actor);
    const engine = app.engine;
    if (action === "discard") {
      const result = await engine.discardTemporaryArtifacts(id, actor);
      return json({ snapshot: publicSnapshot(result.snapshot), rollback: result.rollback }, result.rollback.status === "ROLLBACK_FAILED" ? 500 : 200);
    }
    const snapshot = action === "execute" ? await engine.executeWorkflow(id, actor)
      : action === "pause" ? engine.pauseWorkflow(id, actor) : await engine.resumeWorkflow(id, actor);
    return json({ snapshot: publicSnapshot(snapshot) });
  } catch (error) { return apiFailure(error); }
}
export async function approvalAction(request: Request, context: { params: Promise<{ id: string }> }, decision: "APPROVED" | "REJECTED") {
  try {
    const actor = await resolveSessionActor(request);
    const { id } = await context.params; WorkflowIdSchema.parse(id);
    const input = DecisionSchema.parse(await readJson(request));
    if (input.actor !== actor.id) throw new AuthorizationError("요청자와 세션이 일치하지 않습니다.");
    const app = getRuntime();
    const approval = app.repo.getApproval(id);
    if (!approval) throw new ApiError(404, "결정 요청을 찾을 수 없습니다.");
    assertWorkflowAccess(app, approval.workflowId, actor);
    if (approval.kind !== "APPROVAL") throw new ApiError(409, "이 요청은 확인 단계입니다.");
    const snapshot = await app.engine.resolveApproval(id, decision, input.expectedVersion, actor);
    return json({ snapshot: publicSnapshot(snapshot) }, snapshot.workflow.errorCode === "ROLLBACK_FAILED" ? 500 : 200);
  } catch (error) { return apiFailure(error); }
}
export async function confirmationAction(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveSessionActor(request);
    const { id } = await context.params; WorkflowIdSchema.parse(id);
    const input = DecisionSchema.extend({ approvalId: WorkflowIdSchema, decision: z.enum(["APPROVED", "REJECTED"]).default("APPROVED") }).parse(await readJson(request));
    if (input.actor !== actor.id) throw new AuthorizationError("요청자와 세션이 일치하지 않습니다.");
    const app = getRuntime();
    assertWorkflowAccess(app, id, actor);
    const approval = app.repo.getApproval(input.approvalId);
    if (!approval || approval.workflowId !== id) throw new ApiError(404, "확인 요청을 찾을 수 없습니다.");
    if (approval.kind !== "CONFIRM") throw new ApiError(409, "이 요청은 승인 단계입니다.");
    const snapshot = await app.engine.resolveApproval(approval.id, input.decision, input.expectedVersion, actor);
    return json({ snapshot: publicSnapshot(snapshot) });
  } catch (error) { return apiFailure(error); }
}
