import type Database from "better-sqlite3";
import { recordActivity } from "../audit/activity";
import { ModelSettingsRepository, ModelConfigurationError } from "./model-settings";
import type { CredentialStore } from "./credentials";
import type { AiProvider } from "./provider";
import { createProvider } from "./registry";
import { resolveProviderProfile } from "./presets";
import { assertSafeCloudRequest } from "./privacy";

export function createRoutedProvider(input: { db: Database.Database; credentials?: CredentialStore; ownerSessionId: string; taskId?: string }): AiProvider {
  const prefs = new ModelSettingsRepository(input.db).get(input.ownerSessionId);
  const selection = { provider: prefs.provider, model: prefs.model, effort: "default" };
  try { resolveProviderProfile(selection.provider, selection.model, selection.effort); } catch { throw new ModelConfigurationError("Nebius의 NVIDIA 모델을 선택하세요."); }
  const provider = async () => {
    const key = selection.provider === "demo" ? undefined : await input.credentials?.getCredentialForProvider(input.ownerSessionId, "nebius") ?? undefined;
    if (selection.provider !== "demo" && !key) throw new ModelConfigurationError("Nebius API 키를 먼저 저장하세요.");
    return createProvider({ ...selection, apiKey: key });
  };
  return {
    id: selection.provider, model: selection.model,
    async analyzeDocument(request) {
      if (selection.provider !== "demo") assertSafeCloudRequest(request);
      recordActivity(input.db, input.ownerSessionId, input.taskId ?? null, "MODEL_REQUEST_STARTED", { provider: selection.provider, model: selection.model });
      const result = await (await provider()).analyzeDocument(request);
      recordActivity(input.db, input.ownerSessionId, input.taskId ?? null, selection.provider === "demo" ? "FIXTURE_RESPONSE" : "NEBIUS_MODEL_RESPONSE",
        { provider: selection.provider, model: selection.model, responseIds: result.provider.inference?.receipts.map(receipt => receipt.responseId).join(",") ?? "",
          inferenceReceipts: result.provider.inference?.receipts.length ?? 0 });
      return result;
    },
    async testConnection() { return (await provider()).testConnection(); }
  };
}
