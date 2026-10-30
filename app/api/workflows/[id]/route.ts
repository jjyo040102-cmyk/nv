import { WorkflowIdSchema } from "@/lib/api/schemas";
import { getRuntime } from "@/lib/api/runtime";
import { ApiError, apiFailure, json, publicSnapshot } from "@/lib/api/responses";
import { resolveSessionActor } from "@/lib/security/session";
import { assertWorkflowAccess } from "@/lib/api/access";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const actor = await resolveSessionActor(request);
    const { id } = await context.params; WorkflowIdSchema.parse(id);
    const app = getRuntime();
    assertWorkflowAccess(app, id, actor);
    if (!app.repo.getWorkflow(id)) throw new ApiError(404, "워크플로를 찾을 수 없습니다.");
    return json({ snapshot: publicSnapshot(app.engine.getSnapshot(id)) });
  } catch (error) { return apiFailure(error); }
}
