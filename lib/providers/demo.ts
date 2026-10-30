import type { WorkflowAnalysis, WorkflowTask, ActionRisk } from "../domain/types";
import type { AiProvider, ProviderHealth } from "./provider";
import type { AnalyzeDocumentRequest } from "./prompts";
import { AnalysisResultSchema } from "./schemas";

export const OFFICIAL_DEMO_TEXT = `교육 운영팀 발신
AI 교육 참가자 명단을 2026-11-20까지 제출.
참가 대상 직원을 확인.
예상 출장비 180,000원. 출장비가 100,000원 이상이면 관리자 승인 필요.
최종 회신 문서를 작성하고 외부 발송 전 사용자 확인.`;
const risk: ActionRisk = { moneyMovement: 0, externalTransmission: 0, sensitiveData: 0, legalEffect: 0,
  organizationalAuthority: 0, userRepresentation: 0, destructiveMutation: 0, reversibility: 5 };
function task(id: string, title: string, kind: WorkflowTask["kind"], actionType: string, dependsOn: string[]): WorkflowTask {
  return { id, title, kind, actionType, dependsOn, condition: null, expectedOutput: null, suggestedPolicy: "AUTO", risk };
}
function normalize(text: string): string { return text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim(); }

/** Demo recognition is limited to the bundled sample, including its task-context wrapper. */
function isOfficialDemo(text: string): boolean {
  if (normalize(text) === normalize(OFFICIAL_DEMO_TEXT)) return true;
  if (text.length > 180000) return false;
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object") return false;
    const context = value as {schemaVersion?:unknown;sourceDocuments?:unknown;inboundEmail?:unknown};
    if (context.schemaVersion !== "actflow-task-context-v1" || context.inboundEmail != null || !Array.isArray(context.sourceDocuments) || context.sourceDocuments.length !== 1) return false;
    const source: unknown = context.sourceDocuments[0];
    return Boolean(source && typeof source === "object" && "text" in source && typeof source.text === "string" && normalize(source.text) === normalize(OFFICIAL_DEMO_TEXT));
  } catch { return false; }
}

export class DemoProvider implements AiProvider {
  readonly id = "demo" as const;
  readonly model = "actflow-demo-v1";
  async analyzeDocument(request: AnalyzeDocumentRequest): Promise<WorkflowAnalysis> {
    if (!isOfficialDemo(request.text)) {
      return AnalysisResultSchema.parse({
        summary: "데모 제공자가 알 수 없는 문서입니다. 사람이 검토해야 합니다.", facts: [],
        tasks: [{ ...task("human_review", "문서 직접 검토", "HUMAN_ONLY", "human.review", []), suggestedPolicy: "HUMAN_ONLY" }],
        edges: [], warnings: ["데모 분석 모드 — 실제 LLM 호출 없음. 이 문서는 공식 데모 샘플과 일치하지 않습니다."],
        provider: { provider: "demo", model: this.model, mode: "demo", realModelCalled: false }
      });
    }
    return AnalysisResultSchema.parse({
      summary: "AI 교육 참가 대상 직원 확인, 명단과 회신 작성, 출장비 승인, 발송 확인",
      facts: [
        { key: "sender", value: "교육 운영팀", confidence: 1, evidence: { source: request.sourceName, quoteOrLocator: "교육 운영팀 발신" } },
        { key: "deadline", value: "2026-11-20", confidence: 1, evidence: { source: request.sourceName, quoteOrLocator: "AI 교육 참가자 명단을 2026-11-20까지 제출." } },
        { key: "expenseKrw", value: "180000", confidence: 1, evidence: { source: request.sourceName, quoteOrLocator: "예상 출장비 180,000원." } },
        { key: "requiredOutput", value: "참가자 명단 XLSX 및 회신 DOCX", confidence: 1, evidence: { source: request.sourceName, quoteOrLocator: "2행, 5행" } }
      ],
      tasks: [
        task("lookup", "교육 참가 대상 직원 조회", "DATA_LOOKUP", "employee.lookup", []),
        { ...task("expense", "출장비 관리자 승인", "APPROVAL", "expense.process", ["lookup"]), risk: { ...risk, moneyMovement: 2 } },
        task("xlsx", "참가자 명단 XLSX 작성", "DOCUMENT_GENERATION", "artifact.xlsx.participants", ["expense"]),
        task("docx", "교육 참석 회신 DOCX 작성", "DOCUMENT_GENERATION", "artifact.docx.response", ["expense"]),
        { ...task("email", "외부 발송 확인 · 데모 시뮬레이션", "EXTERNAL_ACTION", "demo.email.simulate", ["xlsx", "docx"]),
          risk: { ...risk, externalTransmission: 3 } },
        task("done", "검증 결과 정리", "COMPLETION", "workflow.complete", ["email"])
      ],
      edges: [
        { from: "lookup", to: "expense", condition: "always" },
        { from: "expense", to: "xlsx", condition: "approved" },
        { from: "expense", to: "docx", condition: "approved" },
        { from: "xlsx", to: "email", condition: "always" },
        { from: "docx", to: "email", condition: "always" },
        { from: "email", to: "done", condition: "confirmed" }
      ],
      warnings: ["데모 분석 모드 — 실제 LLM 호출 없음. 실제 이메일은 발송되지 않습니다."],
      provider: { provider: "demo", model: this.model, mode: "demo", realModelCalled: false }
    });
  }
  async testConnection(): Promise<ProviderHealth> { return { ok: true, provider: "demo", model: this.model, message: "오프라인 데모 준비 완료", latencyMs: 0 }; }
}
