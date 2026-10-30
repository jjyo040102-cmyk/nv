import { createHash } from "node:crypto";
import type { ProviderMetadata, WorkflowAnalysis } from "../domain/types";
import { buildAnalysisPrompt } from "./prompts";
import { analyzeStructuredText, providerOutputInstructions, PROVIDER_OUTPUT_JSON_SCHEMA, type AiProvider, type AnalyzeDocumentRequest, type ProviderHealth } from "./provider";
import { ProviderConnectionError, ProviderOutputError } from "./errors";
import { requestEndpointJson } from "./safe-http";
import { NEBIUS_BASE_URL, resolveProviderProfile } from "./presets";
import { assertSafeCloudRequest } from "./privacy";

function completion(value: unknown, model: string): { text: string; receipt: NonNullable<ProviderMetadata["inference"]>["receipts"][number] } {
  if (!value || typeof value !== "object") throw new ProviderOutputError("nebius");
  const result = value as { id?: unknown; model?: unknown; choices?: Array<{ finish_reason?: unknown; message?: { content?: unknown } }>; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
  if (typeof result.id !== "string" || !result.id || result.id.length > 500 || /[\r\n\0]/.test(result.id) || result.model !== model || !Array.isArray(result.choices) || result.choices.length !== 1 ||
      result.choices[0].finish_reason !== "stop" || typeof result.choices[0].message?.content !== "string" || !result.choices[0].message.content.trim()) throw new ProviderOutputError("nebius");
  const tokens = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  return { text: result.choices[0].message.content, receipt: { responseId: result.id, model, observedAt: new Date().toISOString(),
    responseSha256: createHash("sha256").update(JSON.stringify(value)).digest("hex"), promptTokens: tokens(result.usage?.prompt_tokens), completionTokens: tokens(result.usage?.completion_tokens) } };
}

/** A fixed Nebius endpoint; no local inference, arbitrary host, or provider fallback. */
export class NebiusProvider implements AiProvider {
  readonly id = "nebius" as const;
  constructor(readonly model: string, private readonly apiKey: string) { resolveProviderProfile(this.id, model); }
  async analyzeDocument(request: AnalyzeDocumentRequest): Promise<WorkflowAnalysis> {
    assertSafeCloudRequest(request);
    const receipts: NonNullable<ProviderMetadata["inference"]>["receipts"] = [];
    const analysis = await analyzeStructuredText({ provider: this.id, model: this.model, mode: "real", realModelCalled: true }, async repair => {
      const messages = buildAnalysisPrompt(request);
      messages[0].content += "\n" + providerOutputInstructions(this.id, this.model) + "\nOutput schema: " + JSON.stringify(PROVIDER_OUTPUT_JSON_SCHEMA);
      if (repair) messages[0].content += "\nThe prior response was invalid. Return exactly one valid schema-conforming JSON object.";
      const response = completion(await requestEndpointJson(NEBIUS_BASE_URL, "chat/completions", this.apiKey,
        { model: this.model, messages, stream: false, temperature: 0, max_tokens: 8192, response_format: { type: "json_object" } }), this.model);
      receipts.push(response.receipt);
      return response.text;
    });
    return { ...analysis, provider: { ...analysis.provider, executionLocation: "API",
      inference: { hostingProvider: "Nebius", modelPublisher: "NVIDIA", endpoint: NEBIUS_BASE_URL, receipts } } };
  }
  async testConnection(): Promise<ProviderHealth> {
    const started = Date.now();
    const available = await requestEndpointJson(NEBIUS_BASE_URL, "models", this.apiKey, undefined, 15_000) as { data?: Array<{ id?: unknown }> } | null;
    if (!Array.isArray(available?.data) || !available.data.some(model => model?.id === this.model)) throw new ProviderConnectionError(this.id, "설정한 NVIDIA 모델이 Nebius 모델 목록에 없습니다. 계정에서 사용 가능한 정확한 ID를 확인하세요.");
    completion(await requestEndpointJson(NEBIUS_BASE_URL, "chat/completions", this.apiKey,
      { model: this.model, messages: [{ role: "user", content: "Reply with OK." }], max_tokens: 128, stream: false, temperature: 0 }, 30_000), this.model);
    return { ok: true, provider: this.id, model: this.model, message: "Nebius의 NVIDIA 모델 목록과 실제 추론 응답을 확인했습니다.", latencyMs: Date.now() - started };
  }
}
