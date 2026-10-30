import { createHash } from "node:crypto";
import type { ProviderId, WorkflowAnalysis } from "../domain/types";
import { ProviderOutputError } from "./errors";
import { type AnalyzeDocumentRequest, PROMPT_SCHEMA_VERSION } from "./prompts";
import { AnalysisResultSchema } from "./schemas";

export type { AnalyzeDocumentRequest } from "./prompts";
export type ProviderHealth = { ok: boolean; provider: ProviderId; model?: string; message: string; latencyMs?: number };
export type ProviderEffort = "low" | "medium" | "high" | "xhigh" | "max";
export function providerOutputInstructions(provider: ProviderId, model: string, effort?: ProviderEffort): string {
  return "The provider field must equal this trusted server metadata: " + JSON.stringify({ provider, model, mode: "real", effort: effort ?? "default", realModelCalled: true }) +
    ". Include all required JSON schema fields. Every fact needs evidence with source and quoteOrLocator strings; every task needs suggestedPolicy. Use an empty evidence quote only when no exact locator exists.";
}
export interface AiProvider {
  readonly id: ProviderId;
  readonly model: string;
  readonly effort?: ProviderEffort;
  analyzeDocument(request: AnalyzeDocumentRequest): Promise<WorkflowAnalysis>;
  testConnection(): Promise<ProviderHealth>;
}
type ExpectedMetadata = WorkflowAnalysis["provider"];
type JsonSchema = Record<string, unknown>;
const object = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object", properties, required: Object.keys(properties), additionalProperties: false
});
const string = { type: "string" };
const nullableString = { type: ["string", "null"] };
const risk = object(Object.fromEntries(["moneyMovement","externalTransmission","sensitiveData","legalEffect","organizationalAuthority","userRepresentation","destructiveMutation","reversibility"].map(key => [key, { type: "integer", enum: [0,1,2,3,4,5] }])));
export const PROVIDER_OUTPUT_JSON_SCHEMA: JsonSchema = object({
  summary: string,
  emailReply: { anyOf: [{ type: "null" }, object({ subject: string, body: string, attachGeneratedArtifacts: { type: "boolean" } })] },
  taskOutcome: { anyOf: [{ type: "null" }, object({ status: { type: "string", enum: ["COMPLETE","WAIT","CONTINUE"] }, reason: string, evidenceTaskIds: { type: "array", items: string } })] },
  facts: { type: "array", items: object({ key: string, value: string, confidence: { type: "number" }, evidence: object({ source: string, quoteOrLocator: string }) }) },
  tasks: { type: "array", items: object({
    id: string, title: string, kind: { type: "string", enum: ["ANALYSIS","DATA_LOOKUP","DOCUMENT_GENERATION","DECISION","CONFIRMATION","APPROVAL","EXTERNAL_ACTION","HUMAN_ONLY","COMPLETION"] },
    actionType: string, dependsOn: { type: "array", items: string }, condition: nullableString, expectedOutput: nullableString,
    suggestedPolicy: { type: "string", enum: ["AUTO","CONFIRM","APPROVAL","HUMAN_ONLY"] }, risk
  }) },
  edges: { type: "array", items: object({ from: string, to: string, condition: { type: "string", enum: ["always","approved","confirmed"] } }) },
  warnings: { type: "array", items: string },
  provider: object({ provider: { type: "string", enum: ["demo","nebius"] }, model: string,
    mode: { type: "string", enum: ["demo","real"] }, effort: string, realModelCalled: { type: "boolean" } })
});

export async function analyzeStructuredText(metadata: ExpectedMetadata, requestText: (repair: boolean) => Promise<string>): Promise<WorkflowAnalysis> {
  for (const repair of [false, true]) {
    const text = await requestText(repair);
    try {
      const parsed = AnalysisResultSchema.parse(JSON.parse(text));
      if (parsed.provider.provider !== metadata.provider || parsed.provider.model !== metadata.model ||
          parsed.provider.mode !== metadata.mode || parsed.provider.realModelCalled !== metadata.realModelCalled) throw new Error("Provider metadata mismatch");
      return parsed;
    } catch {
      if (repair) throw new ProviderOutputError(metadata.provider);
    }
  }
  throw new ProviderOutputError(metadata.provider);
}

export class AnalysisCache {
  private readonly entries = new Map<string, WorkflowAnalysis>();
  private key(provider: ProviderId, model: string, request: AnalyzeDocumentRequest, schemaVersion: string): string {
    return createHash("sha256").update(JSON.stringify({ sourceHash: createHash("sha256").update(request.text).digest("hex"),
      sourceName: request.sourceName, provider, model, schemaVersion })).digest("hex");
  }
  get(provider: ProviderId, model: string, request: AnalyzeDocumentRequest, schemaVersion = PROMPT_SCHEMA_VERSION): WorkflowAnalysis | null {
    const value = this.entries.get(this.key(provider, model, request, schemaVersion));
    return value ? structuredClone(value) : null;
  }
  set(provider: ProviderId, model: string, request: AnalyzeDocumentRequest, schemaVersion: string, analysis: WorkflowAnalysis): void {
    this.entries.set(this.key(provider, model, request, schemaVersion), structuredClone(analysis));
    if (this.entries.size > 128) this.entries.delete(this.entries.keys().next().value!);
  }
}
