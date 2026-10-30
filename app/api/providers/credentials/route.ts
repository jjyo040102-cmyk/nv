import { z } from "zod";
import { getRuntime } from "@/lib/api/runtime";
import { apiFailure, json } from "@/lib/api/responses";
import { readJson } from "@/lib/api/schemas";
import { resolveSessionActor } from "@/lib/security/session";
const ProviderSchema = z.literal("nebius");
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const actor = await resolveSessionActor(request); const app = getRuntime();
    return json({ credentials: [app.credentials.getMetadata(actor.sessionId, "nebius")] });
  } catch (error) { return apiFailure(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await resolveSessionActor(request);
    const input = z.object({ provider: ProviderSchema, apiKey: z.string().min(8).max(4096) }).strict().parse(await readJson(request));
    return json({ credential: await getRuntime().credentials.saveCredential(actor.sessionId, input.provider, input.apiKey) }, 201);
  } catch (error) { return apiFailure(error); }
}
export async function DELETE(request: Request) {
  try {
    const actor = await resolveSessionActor(request); const app = getRuntime();
    const input = z.object({ provider: ProviderSchema }).strict().parse(await readJson(request));
    await app.credentials.deleteCredential(actor.sessionId, input.provider);
    return json({ credential: app.credentials.getMetadata(actor.sessionId, input.provider) });
  } catch (error) { return apiFailure(error); }
}
