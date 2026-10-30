import { z } from "zod";
import { getRuntime } from "@/lib/api/runtime";
import { apiFailure, json } from "@/lib/api/responses";
import { readJson } from "@/lib/api/schemas";
import { resolveSessionActor } from "@/lib/security/session";

export const runtime = "nodejs";
const Input = z.object({ from:z.string().min(3), replyTo:z.string().nullable().optional(), messageId:z.string().min(1), threadId:z.string().nullable().optional(), subject:z.string().default(""), body:z.string().default("") }).strict();
export async function POST(request:Request) {
  try {
    const actor = await resolveSessionActor(request);
    const input = Input.parse(await readJson(request));
    const rt = getRuntime();
    if (rt.repo.getSettings().emailTaskDetectionEnabled === false) return json({ event: null, ignored: true, reason: "EMAIL_TASK_DETECTION_DISABLED" }, 202);
    const result = await rt.email.ingestUntrusted(input, actor);
    return json({ event: result }, result.duplicate ? 200 : 201);
  } catch (error) { return apiFailure(error); }
}
