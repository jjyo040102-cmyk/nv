import { getRuntime } from "@/lib/api/runtime";
import { apiFailure, json } from "@/lib/api/responses";
import { assertProjectAccess } from "@/lib/api/task-access";
import { resolveSessionActor } from "@/lib/security/session";
export const runtime="nodejs";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){try{const actor=await resolveSessionActor(request);const{id}=await params;const rt=getRuntime();assertProjectAccess(rt.db,id,actor);return json({state:rt.projectState.summarize({ownerSessionId:actor.sessionId,projectId:id})});}catch(error){return apiFailure(error);}}
