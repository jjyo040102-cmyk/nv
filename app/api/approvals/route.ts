import { getRuntime } from "@/lib/api/runtime";
import { apiFailure, json, publicSnapshot } from "@/lib/api/responses";
import { resolveSessionActor } from "@/lib/security/session";
export const runtime = "nodejs";
export async function GET(request: Request) { try { const actor = await resolveSessionActor(request); const app = getRuntime(); const rows = app.db.prepare("SELECT DISTINCT w.id FROM workflows w JOIN approvals a ON a.workflow_id=w.id WHERE w.owner_session_id=? AND a.status='PENDING' ORDER BY w.created_at DESC").all(actor.sessionId) as Array<{ id: string }>; return json({ snapshots: rows.map(row => publicSnapshot(app.engine.getSnapshot(row.id))) }); } catch (error) { return apiFailure(error); } }
