import { z } from "zod";
import { getRuntime } from "@/lib/api/runtime";
import { apiFailure, json } from "@/lib/api/responses";
import { readJson } from "@/lib/api/schemas";
import { resolveSessionActor } from "@/lib/security/session";
export const runtime = "nodejs";
const CreateProject = z.object({ name:z.string().trim().min(1).max(200), summary:z.string().max(5000).optional() }).strict();
export async function GET(request:Request){try{const actor=await resolveSessionActor(request);return json({projects:getRuntime().projects.list(actor.sessionId)});}catch(error){return apiFailure(error);}}
export async function POST(request:Request){try{const actor=await resolveSessionActor(request);const input=CreateProject.parse(await readJson(request));return json({project:getRuntime().tasks.createProject(input,actor)},201);}catch(error){return apiFailure(error);}}
