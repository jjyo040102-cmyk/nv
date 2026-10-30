import type { NodeStatus, WorkflowAnalysis, WorkflowEdge, WorkflowTask } from "../domain/types";
import { evaluatePolicy } from "../policy/engine";
import type { PolicyDecision, PolicySet } from "../policy/types";
import { getTool, ToolNotAllowedError } from "../tools/registry";
import { normalizeWorkflowAnalysis, topologicalTasks } from "./analysis";
export { topologicalTasks } from "./analysis";

export type GraphNode = {
  id: string;
  workflowId?: string;
  title: string;
  kind: WorkflowTask["kind"];
  actionType: string;
  status: NodeStatus;
  policyClass: PolicyDecision["classification"];
  policy: PolicyDecision;
  task: WorkflowTask;
  result: Record<string, unknown> | null;
  errorMessage: string | null;
};
export type WorkflowGraph = { nodes: GraphNode[]; edges: WorkflowEdge[] };

export function buildWorkflowGraph(analysis: WorkflowAnalysis, policySet: PolicySet): WorkflowGraph {
  analysis = normalizeWorkflowAnalysis(analysis);
  const tasks = topologicalTasks(analysis.tasks);
  const known = new Set(tasks.map(task => task.id));
  for (const edge of analysis.edges) if (!known.has(edge.from) || !known.has(edge.to)) throw new Error("Edge points to unknown task");
  const factValue = (key: string) => analysis.facts.find(fact => fact.key === key)?.value;
  const expenseKrw = Number(factValue("expenseKrw") ?? 0);
  const boolFact = (key: string): boolean | undefined => factValue(key) === undefined ? undefined : factValue(key) === "true";
  const nodes = tasks.map(task => {
    let tool: ReturnType<typeof getTool> | null = null;
    try { tool = getTool(task.actionType); } catch (error) { if (!(error instanceof ToolNotAllowedError)) throw error; }
    const completion = task.kind === "COMPLETION" && task.actionType === "workflow.complete";
    const supported = tool !== null || task.actionType === "expense.process" || completion;
    const policy = completion
      ? { classification: task.suggestedPolicy ?? "AUTO", matchedRules: ["builtin.completion"], policyVersion: policySet.version, modelSuggestion: task.suggestedPolicy ?? null, overrideReason: null }
      : evaluatePolicy({
          actionType: task.actionType,
          amountKrw: task.actionType.startsWith("expense.") ? expenseKrw : 0,
          sensitiveData: task.risk.sensitiveData > 0,
          reversibility: tool?.reversible ?? false,
          externalSideEffect: tool?.externalSideEffect ?? task.kind === "EXTERNAL_ACTION",
          suggestedPolicy: task.suggestedPolicy,
          actorRole: "USER",
          policySet,
          verifiedRecipient: boolFact("emailIdentityEligible"),
          bulkExport: boolFact("emailBulkExport"),
          secretDetected: boolFact("emailSecretDetected"),
          crossScopeData: boolFact("emailCrossScopeData")
        });
    const deterministicEmailPlan = analysis.provider.provider === "demo" && analysis.provider.mode === "demo" &&
      analysis.provider.realModelCalled === false && analysis.provider.model === "actflow-deterministic-email-policy-v1";
    if (task.actionType === "external.email.send" && !deterministicEmailPlan) {
      policy.classification = "HUMAN_ONLY";
      policy.matchedRules = [...policy.matchedRules, "builtin.external-email-deterministic-gate"];
      policy.overrideReason = "일반 AI 분석은 메일 발신자 인증 상태를 부여할 수 없습니다. 검증된 메일 경로만 외부 전송을 허용합니다.";
    } else if (!supported) {
      policy.classification = "HUMAN_ONLY";
      policy.matchedRules = [...policy.matchedRules, "builtin.unavailable-tool-human-only"];
      policy.overrideReason = "등록된 도구가 없어 자동 실행을 차단했습니다.";
    }
    return { id: task.id, title: task.title, kind: task.kind, actionType: task.actionType, status: "READY" as const,
      policyClass: policy.classification, policy, task, result: null, errorMessage: null };
  });
  for (const edge of analysis.edges) {
    const source = nodes.find(node => node.id === edge.from)!;
    if ((edge.condition === "approved" && source.policyClass !== "APPROVAL") ||
        (edge.condition === "confirmed" && source.policyClass !== "CONFIRM")) throw new Error("Graph condition does not match the source decision gate");
  }
  return { nodes, edges: analysis.edges };
}
