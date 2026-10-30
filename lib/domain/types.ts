export type PolicyClass = "AUTO" | "CONFIRM" | "APPROVAL" | "HUMAN_ONLY";
export type NodeKind = "ANALYSIS" | "DATA_LOOKUP" | "DOCUMENT_GENERATION" | "DECISION" | "CONFIRMATION" | "APPROVAL" | "EXTERNAL_ACTION" | "HUMAN_ONLY" | "COMPLETION";
export type NodeStatus = "PENDING" | "READY" | "PREPARING" | "WAITING" | "RUNNING" | "COMPLETED" | "VERIFIED" | "REJECTED" | "ROLLED_BACK" | "FAILED" | "BLOCKED";
export type WorkflowStatus = "DRAFT" | "ANALYZED" | "RUNNING" | "WAITING" | "COMPLETED" | "FAILED" | "PAUSED";
export type ExecutionMode = "MANUAL" | "PRE_EXECUTION";
export type ArtifactState = "TEMPORARY" | "COMMITTED" | "DELETED" | "DELETE_FAILED";
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";
export type ProviderId = "demo" | "nebius";
export type SessionActor = { id: string; sessionId: string; role: "USER" | "APPROVER" };
export type RiskScore = 0 | 1 | 2 | 3 | 4 | 5;
export type ActionRisk = {
  moneyMovement: RiskScore;
  externalTransmission: RiskScore;
  sensitiveData: RiskScore;
  legalEffect: RiskScore;
  organizationalAuthority: RiskScore;
  userRepresentation: RiskScore;
  destructiveMutation: RiskScore;
  reversibility: RiskScore;
};
export type Fact = { key: string; value: string; confidence: number; evidence?: { source: string; quoteOrLocator?: string } };
export type WorkflowTask = {
  id: string;
  title: string;
  kind: NodeKind;
  actionType: string;
  dependsOn: string[];
  condition: string | null;
  expectedOutput: string | null;
  suggestedPolicy?: PolicyClass;
  risk: ActionRisk;
};
export type WorkflowEdge = { from: string; to: string; condition: "always" | "approved" | "rejected" | "confirmed" | "declined" };
export type ProviderMetadata = {
  executionLocation?: "API"; provider: ProviderId; model: string; mode: "demo" | "real"; effort?: string; realModelCalled: boolean;
  inference?: { hostingProvider: "Nebius"; modelPublisher: "NVIDIA"; endpoint: string; receipts: Array<{ responseId: string; model: string; observedAt: string; responseSha256: string; promptTokens?: number; completionTokens?: number }> } };
/** Proposals only. Execution, recipient selection and completion remain backend-verified. */
export type EmailReplyProposal = { subject: string; body: string; attachGeneratedArtifacts: boolean };
export type TaskOutcomeProposal = { status: "COMPLETE" | "WAIT" | "CONTINUE"; reason: string; evidenceTaskIds: string[] };
export type WorkflowAnalysis = {
  summary: string; facts: Fact[]; tasks: WorkflowTask[]; edges: WorkflowEdge[]; warnings: string[]; provider: ProviderMetadata;
  emailReply?: EmailReplyProposal | null;
  taskOutcome?: TaskOutcomeProposal | null;
};
