import { getRuntime } from "@/lib/api/runtime";
import { ApiError, apiFailure, json } from "@/lib/api/responses";
import { ProviderSelectionSchema, readJson } from "@/lib/api/schemas";
import { createProvider } from "@/lib/providers/registry";
import { resolveProviderProfile } from "@/lib/providers/presets";
import { resolveSessionActor } from "@/lib/security/session";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const actor = await resolveSessionActor(request);
    const input = ProviderSelectionSchema.parse(await readJson(request));
    try { resolveProviderProfile(input.provider, input.model, input.effort); }
    catch { throw new ApiError(400, "제공자 설정이 올바르지 않습니다."); }
    const key = input.provider === "demo" ? undefined : await getRuntime().credentials.getCredentialForProvider(actor.sessionId, input.provider) ?? undefined;
    if (input.provider !== "demo" && !key) throw new ApiError(400, "API 키를 먼저 저장하세요.");
    const health = await createProvider({ ...input, apiKey: key }).testConnection();
    return json({ health });
  } catch (error) { return apiFailure(error); }
}
