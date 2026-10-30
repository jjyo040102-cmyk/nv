import { getRuntime } from "@/lib/api/runtime";
import { apiFailure, json } from "@/lib/api/responses";
import { readJson } from "@/lib/api/schemas";
import { updateAppSettings } from "@/lib/api/provider-settings";
import { resolveSessionActor } from "@/lib/security/session";
import { assertApprovalRole } from "@/lib/auth/roles";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { await resolveSessionActor(request); return json({ settings: getRuntime().repo.getSettings() }); }
  catch (error) { return apiFailure(error); }
}
export async function POST(request: Request) {
  try { const actor=await resolveSessionActor(request); const app=getRuntime(); if (!app.config.demoAuth) assertApprovalRole(actor); return json({ settings: updateAppSettings(app, await readJson(request),actor.sessionId) }); }
  catch (error) { return apiFailure(error); }
}
