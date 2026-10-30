import {ModelSettingsRepository} from "../providers/model-settings";
import type { ApiRuntime } from "./runtime";
import { ApiError } from "./responses";
import { SettingsRequestSchema } from "./schemas";
import { resolveProviderProfile } from "../providers/presets";

export function updateAppSettings(app: ApiRuntime, raw: unknown, ownerSessionId?:string) {
  const input = SettingsRequestSchema.parse(raw);
  if (input.securityLevel !== undefined && input.securityLevel !== "HIGH") throw new ApiError(400, "이 빌드는 보안 보호를 높음으로 고정합니다.");
  const current = app.repo.getSettings();
  const next = { ...current, ...input };
  if ((next.executionMode === "PRE_EXECUTION") !== next.preExecutionEnabled) throw new ApiError(400, "모드와 사전 실행 설정이 일치하지 않습니다.");
  try { resolveProviderProfile(next.providerId, next.model, next.effort ?? "default"); }
  catch { throw new ApiError(400, "모델과 제공자 또는 effort 설정을 확인하세요."); }
  return app.db.transaction(()=>{
    const updated=app.repo.updateSettings(input);
    if(ownerSessionId&&(input.providerId!==undefined||input.model!==undefined||input.effort!==undefined))new ModelSettingsRepository(app.db).update(ownerSessionId,{provider:updated.providerId,model:updated.model,effort:null});
    return updated;
  })();
}
