import type { ProviderId } from "../domain/types";
import type { WorkflowAnalyzer } from "../workflow/engine";
import { DemoProvider } from "./demo";
import { NebiusProvider } from "./nebius";
import { resolveProviderProfile } from "./presets";
import type { AiProvider } from "./provider";

export type ProviderSelection = { provider: ProviderId; model: string; effort?: string; apiKey?: string };
export function createProvider(selection: ProviderSelection): AiProvider {
  const profile = resolveProviderProfile(selection.provider, selection.model, selection.effort ?? "default");
  if (profile.provider === "demo") return new DemoProvider();
  if (!selection.apiKey?.trim()) throw new Error("제공자 API 키가 필요합니다.");
  return new NebiusProvider(profile.model, selection.apiKey);
}
export function createWorkflowAnalyzer(provider: AiProvider): WorkflowAnalyzer {
  return input => provider.analyzeDocument({ text: input.sourceText, sourceName: input.sourceName, locale: input.locale });
}
