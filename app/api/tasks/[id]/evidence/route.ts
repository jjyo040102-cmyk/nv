import { getRuntime } from "@/lib/api/runtime";
import { apiFailure } from "@/lib/api/responses";
import { resolveSessionActor } from "@/lib/security/session";
import { exportTaskEvidence } from "@/lib/tasks/evidence-export";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveSessionActor(request), { id } = await params, app = getRuntime();
    const evidence = await exportTaskEvidence(app.db, app.config.dataDir, id, actor);
    return new Response(JSON.stringify(evidence, null, 2), { headers: {
      "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store",
      "content-disposition": 'attachment; filename="actflow-evidence.json"', "x-content-type-options": "nosniff"
    } });
  } catch (error) { return apiFailure(error); }
}
