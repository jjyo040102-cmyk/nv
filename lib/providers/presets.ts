import type { ProviderId } from "../domain/types";
import type { ProviderEffort } from "./provider";

export const NEBIUS_BASE_URL = "https://api.tokenfactory.nebius.com/v1";
export const DEFAULT_NVIDIA_MODEL = "nvidia/nemotron-3-super-120b-a12b";
export function fixtureModelEnabled(): boolean {
  return process.env.ACTFLOW_TEST_MODE === "true" && process.env.NODE_ENV !== "production";
}
export type ProviderPreset = { provider: ProviderId; label: string; model: string; extraHighEffort: "xhigh" | null; documentation: string };
export function listProviderPresets(): ProviderPreset[] {
  return [{ provider: "nebius", label: "NVIDIA Nemotron 3 Super · Nebius", model: DEFAULT_NVIDIA_MODEL, extraHighEffort: null,
    documentation: "https://github.com/nebius/token-factory-cookbook/blob/main/models/nemotron/nemotron3-super-120B.md" }];
}
export function resolveProviderProfile(provider: ProviderId, model: string, effort = "default"): { provider: ProviderId; model: string; apiEffort: ProviderEffort | null } {
  if (provider === "demo" && fixtureModelEnabled() && model === "actflow-demo-v1" && effort === "default") return { provider, model, apiEffort: null };
  if (provider !== "nebius") throw new Error("이 빌드는 Nebius Token Factory만 지원합니다.");
  if (!/^nvidia\/[A-Za-z0-9][A-Za-z0-9._-]{2,139}$/.test(model)) throw new Error("Nebius에서 제공하는 NVIDIA 모델 ID가 필요합니다.");
  if (effort !== "default") throw new Error("이 연결은 모델 기본 추론 설정을 사용합니다.");
  return { provider, model, apiEffort: null };
}
