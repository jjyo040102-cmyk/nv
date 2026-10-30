import { WorkflowIdSchema } from "@/lib/api/schemas";
import { getRuntime } from "@/lib/api/runtime";
import { ApiError, apiFailure, json } from "@/lib/api/responses";
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
    const value = new URL(request.url).searchParams.get("after") ?? request.headers.get("last-event-id") ?? "0";
    const after = Number(value);
    if (!Number.isSafeInteger(after) || after < 0) throw new ApiError(400, "이벤트 번호가 올바르지 않습니다.");
    const events = app.engine.getSnapshot(id).events.filter(event => event.sequence > after);
    if (request.headers.get("accept")?.includes("text/event-stream")) {
      const payload = events.map(event => `id: ${event.sequence}\nevent: ${event.eventType}\ndata: ${JSON.stringify(event)}\n\n`).join("") + ": end-of-batch\n\n";
      return new Response(payload, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" } });
    }
    return json({ events, nextSequence: events.at(-1)?.sequence ?? after });
  } catch (error) { return apiFailure(error); }
}
