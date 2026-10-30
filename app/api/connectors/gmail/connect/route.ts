import { getRuntime } from "@/lib/api/runtime";
import { resolveSessionActor } from "@/lib/security/session";
import { apiFailure, json } from "@/lib/api/responses";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try { const actor = await resolveSessionActor(request); return json({ url: getRuntime().gmail.begin(actor.sessionId, actor.id) }); }
  catch (error) { return apiFailure(error); }
}
