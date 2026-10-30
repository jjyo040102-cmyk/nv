import { z } from "zod";
import { getRuntime } from "@/lib/api/runtime";
import { resolveSessionActor } from "@/lib/security/session";
import { apiFailure, json } from "@/lib/api/responses";
import { readJson } from "@/lib/api/schemas";
export const runtime = "nodejs";
export async function GET(request: Request) { try { const actor = await resolveSessionActor(request); return json({ messages: await getRuntime().gmailClient.inbox(actor.sessionId) }); } catch (error) { return apiFailure(error); } }
export async function POST(request: Request) {
  try { const actor = await resolveSessionActor(request); const input = z.object({ messageId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/) }).strict().parse(await readJson(request)); return json(await getRuntime().gmailSync.import(actor.sessionId, input.messageId)); }
  catch (error) { return apiFailure(error); }
}
