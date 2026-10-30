import { z } from "zod";
import { getRuntime } from "@/lib/api/runtime";
import { apiFailure, json, ApiError } from "@/lib/api/responses";
import { readJson } from "@/lib/api/schemas";
import { assertProjectAccess } from "@/lib/api/task-access";
import { resolveSessionActor } from "@/lib/security/session";
export const runtime="nodejs";
const Patch=z.object({name:z.string().trim().min(1).max(200).optional(),summary:z.string().max(5000).nullable().optional(),status:z.enum(["ACTIVE","PAUSED","ARCHIVED"]).optional(),version:z.number().int().nonnegative()}).strict();
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){try{const actor=await resolveSessionActor(request);const {id}=await params;const rt=getRuntime();assertProjectAccess(rt.db,id,actor);const project=rt.projects.get(id,actor.sessionId);if(!project)throw new ApiError(404,"프로젝트를 찾을 수 없습니다.");return json({project});}catch(error){return apiFailure(error);}}
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){try{const actor=await resolveSessionActor(request);const {id}=await params;const rt=getRuntime();assertProjectAccess(rt.db,id,actor);const {version,...patch}=Patch.parse(await readJson(request));return json({project:rt.projects.update(id,actor.sessionId,version,patch)});}catch(error){return apiFailure(error);}}
