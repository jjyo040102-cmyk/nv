import { z } from "zod";
import { getRuntime } from "@/lib/api/runtime";
import { resolveSessionActor } from "@/lib/security/session";
import { apiFailure, json } from "@/lib/api/responses";
import { readJson } from "@/lib/api/schemas";
export const runtime = "nodejs";
export async function GET(request: Request) { try { const actor = await resolveSessionActor(request); return json(getRuntime().gmail.status(actor.sessionId)); } catch (error) { return apiFailure(error); } }
export async function POST(request: Request) {
  try { const actor = await resolveSessionActor(request); const input = z.object({ watching: z.boolean() }).strict().parse(await readJson(request)); getRuntime().gmail.watch(actor.sessionId, input.watching); return json(getRuntime().gmail.status(actor.sessionId)); }
  catch (error) { return apiFailure(error); }
}
export async function DELETE(request: Request) { try { const actor = await resolveSessionActor(request); getRuntime().gmail.disconnect(actor.sessionId); return json({ disconnected: true }); } catch (error) { return apiFailure(error); } }
