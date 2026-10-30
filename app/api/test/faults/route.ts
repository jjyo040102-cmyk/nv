import { z } from "zod";
import { getRuntime } from "@/lib/api/runtime";
import { assertWorkflowAccess } from "@/lib/api/access";
import { ApiError, apiFailure, json } from "@/lib/api/responses";
import { WorkflowIdSchema, readJson } from "@/lib/api/schemas";
import { resolveSessionActor } from "@/lib/security/session";
import { getTestAttempts, setTestFault, testFaultsEnabled } from "@/lib/testing/faults";
function guard(request: Request): void {
  if (!testFaultsEnabled() || !process.env.ACTFLOW_TEST_FAULT_SECRET || request.headers.get("x-actflow-test-secret") !== process.env.ACTFLOW_TEST_FAULT_SECRET) throw new ApiError(404, "경로를 찾을 수 없습니다.");
}
export const runtime = "nodejs";
export async function POST(request: Request) { try { guard(request); const actor = await resolveSessionActor(request); const input = z.object({ workflowId: WorkflowIdSchema, fault: z.enum(["malformed-provider", "rollback-delete"]) }).strict().parse(await readJson(request)); assertWorkflowAccess(getRuntime(), input.workflowId, actor); setTestFault(input.workflowId, input.fault); return json({ configured: true }); } catch (error) { return apiFailure(error); } }
export async function GET(request: Request) { try { guard(request); const id = WorkflowIdSchema.parse(new URL(request.url).searchParams.get("workflowId")); const actor = await resolveSessionActor(request); assertWorkflowAccess(getRuntime(), id, actor); return json({ attempts: getTestAttempts(id) }); } catch (error) { return apiFailure(error); } }
