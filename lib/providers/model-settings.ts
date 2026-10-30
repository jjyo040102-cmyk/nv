import type Database from "better-sqlite3";
import type { ProviderId } from "../domain/types";
import { SettingsRepository } from "../db/settings-repository";
import { recordActivity } from "../audit/activity";
import { resolveProviderProfile } from "./presets";
import { DomainError } from "../domain/errors";

export type ModelPreferences = { provider: ProviderId; model: string; effort: null };
export class ModelConfigurationError extends DomainError { constructor(message: string) { super("MODEL_CONFIGURATION", message); this.name = "ModelConfigurationError"; } }
export function validateModelPreferences(value: ModelPreferences): ModelPreferences {
  if (!value || Object.keys(value).some(key => !["provider", "model", "effort"].includes(key)) || value.effort !== null) throw new ModelConfigurationError("지원하지 않는 AI 연결 설정입니다.");
  try { resolveProviderProfile(value.provider, value.model); } catch { throw new ModelConfigurationError("Nebius의 NVIDIA 모델을 선택하세요."); }
  return value;
}
export class ModelSettingsRepository {
  constructor(private readonly db: Database.Database) {}
  get(ownerSessionId: string): ModelPreferences {
    const row = this.db.prepare("SELECT preferences_json FROM model_preferences WHERE owner_session_id=?").get(ownerSessionId) as { preferences_json: string } | undefined;
    if (row) return validateModelPreferences(JSON.parse(row.preferences_json));
    const settings = new SettingsRepository(this.db).getSettings();
    return validateModelPreferences({ provider: settings.providerId, model: settings.model, effort: null });
  }
  update(ownerSessionId: string, patch: unknown): ModelPreferences {
    if (!ownerSessionId || !patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).some(key => !["provider", "model", "effort"].includes(key))) throw new ModelConfigurationError("지원하지 않는 AI 연결 설정입니다.");
    const next = validateModelPreferences({ ...this.get(ownerSessionId), ...patch });
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO model_preferences(owner_session_id,preferences_json,version,updated_at) VALUES (?,?,0,?) ON CONFLICT(owner_session_id) DO UPDATE SET preferences_json=excluded.preferences_json,version=model_preferences.version+1,updated_at=excluded.updated_at")
        .run(ownerSessionId, JSON.stringify(next), new Date().toISOString());
      recordActivity(this.db, ownerSessionId, null, "MODEL_SELECTION_CHANGED", { provider: next.provider, model: next.model });
    })();
    return next;
  }
}
