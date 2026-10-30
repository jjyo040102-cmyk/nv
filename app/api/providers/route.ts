import {ModelSettingsRepository} from "@/lib/providers/model-settings";
import { getRuntime } from "@/lib/api/runtime";
import { apiFailure, json } from "@/lib/api/responses";
import { readJson,SettingsRequestSchema } from "@/lib/api/schemas";
import { listProviderPresets } from "@/lib/providers/presets";
import { resolveSessionActor } from "@/lib/security/session";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const actor = await resolveSessionActor(request); const app = getRuntime();
    const model=new ModelSettingsRepository(app.db).get(actor.sessionId);
    return json({ presets: listProviderPresets(), selected: {...app.repo.getSettings(),providerId:model.provider,model:model.model,effort:model.effort},
      credentials: [app.credentials.getMetadata(actor.sessionId, "nebius")] });
  } catch (error) { return apiFailure(error); }
}
export async function POST(request: Request) {
  try {
    const actor=await resolveSessionActor(request),app=getRuntime();
    const input=SettingsRequestSchema.pick({providerId:true,model:true,effort:true}).parse(await readJson(request));
    const previous=new ModelSettingsRepository(app.db).get(actor.sessionId);
    const model=new ModelSettingsRepository(app.db).update(actor.sessionId,{provider:input.providerId??previous.provider,model:input.model??previous.model,effort:null});
    return json({selected:{...app.repo.getSettings(),providerId:model.provider,model:model.model,effort:model.effort}});
  }
  catch (error) { return apiFailure(error); }
}
