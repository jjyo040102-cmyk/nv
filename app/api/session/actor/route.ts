import { z } from "zod";
import { readConfig } from "@/lib/config";
import { apiFailure, json } from "@/lib/api/responses";
import { readJson } from "@/lib/api/schemas";
import { createDemoSessionCookie, resolveSessionActor } from "@/lib/security/session";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { return json({ actor: await resolveSessionActor(request), demoAuth: readConfig(process.env).demoAuth }); }
  catch (error) { return apiFailure(error); }
}
export async function POST(request: Request) {
  try {
    await resolveSessionActor(request);
    const input = z.object({ role: z.enum(["USER", "APPROVER"]) }).strict().parse(await readJson(request));
    const cookie = createDemoSessionCookie(input.role);
    const response = json({ actor: { id: input.role === "APPROVER" ? "demo-approver" : "demo-user", role: input.role, sessionId: "actflow-local-demo" }, demoAuth: true });
    response.headers.set("set-cookie", `${cookie}; HttpOnly; SameSite=Strict; Path=/${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`);
    return response;
  } catch (error) { return apiFailure(error); }
}
