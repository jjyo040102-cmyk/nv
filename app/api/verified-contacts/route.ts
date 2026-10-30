import { z } from "zod";
import { getRuntime } from "@/lib/api/runtime";
import { apiFailure, json } from "@/lib/api/responses";
import { readJson } from "@/lib/api/schemas";
import { resolveSessionActor } from "@/lib/security/session";

export const runtime = "nodejs";
const Input = z.object({ emailAddress:z.string().min(3), displayName:z.string().max(200).nullable().optional(), autoReplyEnabled:z.boolean().default(true) }).strict();
export async function GET(request:Request) { try { const actor=await resolveSessionActor(request); return json({ contacts:getRuntime().verifiedContacts.list(actor.sessionId) }); } catch(error){ return apiFailure(error); } }
export async function POST(request:Request) { try { const actor=await resolveSessionActor(request); const input=Input.parse(await readJson(request)); return json({ contact:getRuntime().verifiedContacts.upsert({ ownerSessionId:actor.sessionId, ...input }) },201); } catch(error){ return apiFailure(error); } }
