import { z } from "zod";
import { getRuntime } from "@/lib/api/runtime";
import { apiFailure, json } from "@/lib/api/responses";
import { readJson } from "@/lib/api/schemas";
import { resolveSessionActor } from "@/lib/security/session";
export const runtime="nodejs";
const CreateTask=z.object({requestId:z.string().uuid().optional(),sourceWorkflowId:z.string().uuid().optional(),title:z.string().trim().min(1).max(240),goal:z.string().trim().min(1).max(20000),projectId:z.string().uuid().nullable().optional(),backgroundWatchEnabled:z.boolean().optional(),speculativePreparationEnabled:z.boolean().optional()}).strict();
export async function GET(request:Request){try{const actor=await resolveSessionActor(request);return json({tasks:getRuntime().tasks.list(actor)});}catch(error){return apiFailure(error);}}
export async function POST(request:Request){try{const actor=await resolveSessionActor(request);const input=CreateTask.parse(await readJson(request));return json({task:getRuntime().tasks.createGoal(input,actor)},201);}catch(error){return apiFailure(error);}}
