import { z } from "zod";
import { getRuntime } from "@/lib/api/runtime";
import { resolveSessionActor } from "@/lib/security/session";
import { assertTaskAccess } from "@/lib/api/task-access";
import { apiFailure, json } from "@/lib/api/responses";
import { readJson } from "@/lib/api/schemas";
import { GoalContracts } from "@/lib/tasks/goal-contract";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const actor = await resolveSessionActor(request), { id } = await params, app = getRuntime(); assertTaskAccess(app.db, id, actor);
    const input = z.object({ version: z.number().int().positive(), confirmedIds: z.array(z.string().uuid()).max(200) }).strict().parse(await readJson(request));
    return json({ task: await new GoalContracts(app.db).complete(id, actor, input.version, input.confirmedIds, app.config.dataDir) });
  } catch (error) { return apiFailure(error); }
}
