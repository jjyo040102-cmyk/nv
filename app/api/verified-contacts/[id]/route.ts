import { z } from "zod";
import { getRuntime } from "@/lib/api/runtime";
import { ApiError, apiFailure, json } from "@/lib/api/responses";
import { readJson } from "@/lib/api/schemas";
import { resolveSessionActor } from "@/lib/security/session";

export const runtime = "nodejs";
const Patch = z.object({ displayName:z.string().max(200).nullable().optional(), autoReplyEnabled:z.boolean().optional() }).strict();
export async function PATCH(request:Request, context:{params:Promise<{id:string}>}) { try { const actor=await resolveSessionActor(request); const {id}=await context.params; const input=Patch.parse(await readJson(request)); const repo=getRuntime().verifiedContacts; if(!repo.get(id,actor.sessionId))throw new ApiError(404,"인증된 연락처를 찾을 수 없습니다."); return json({contact:repo.update(id,actor.sessionId,input)}); } catch(error){ return apiFailure(error); } }
export async function DELETE(request:Request, context:{params:Promise<{id:string}>}) { try { const actor=await resolveSessionActor(request); const {id}=await context.params; const removed=getRuntime().verifiedContacts.remove(id,actor.sessionId); if(!removed)throw new ApiError(404,"인증된 연락처를 찾을 수 없습니다."); return json({removed:true}); } catch(error){ return apiFailure(error); } }
