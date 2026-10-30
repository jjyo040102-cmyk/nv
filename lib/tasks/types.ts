import type { ExecutionMode, ProviderId } from "../domain/types";

export type ProjectStatus = "ACTIVE" | "PAUSED" | "ARCHIVED";
export type LivingTaskStatus = "DRAFT" | "READY" | "RUNNING" | "WAITING_EVENT" | "WAITING_APPROVAL" | "PAUSED" | "COMPLETED" | "FAILED" | "CANCELLED" | "BLOCKED";
export type AutomationProfile = "SAFE" | "AUTOMATIC" | "CUSTOM";
export type SecurityLevel = "HIGH" | "STANDARD" | "CUSTOM";
export type MemoryScope = "USER" | "PROJECT" | "TASK" | "DECISION" | "EVIDENCE";
export type TriggerType = "EMAIL" | "TIME" | "WEBHOOK" | "MANUAL" | "FILE_CHANGE" | "GIT_CHANGE" | "CALENDAR" | "WEB_CHANGE";
export type WakeEventStatus = "PENDING" | "PROCESSING" | "PROCESSED" | "FAILED";
export type SenderAuthStatus = "PASS" | "FAIL" | "SUSPICIOUS" | "MISSING";
export type AgentSessionStatus = "ACTIVE" | "PAUSED" | "CLOSED";

export type ProjectRecord = {
  id: string;
  ownerSessionId: string;
  name: string;
  status: ProjectStatus;
  summary: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type LivingTaskRecord = {
  id: string;
  ownerSessionId: string;
  projectId: string | null;
  title: string;
  goal: string;
  status: LivingTaskStatus;
  executionMode: ExecutionMode;
  backgroundWatchEnabled: boolean;
  speculativePreparationEnabled: boolean;
  currentWorkflowId: string | null;
  agentSessionId: string | null;
  nextActionSummary: string | null;
  waitingReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type MemoryEntryRecord = {
  id: string;
  ownerSessionId: string;
  projectId: string | null;
  livingTaskId: string | null;
  scope: MemoryScope;
  key: string;
  valueJson: unknown;
  summary: string;
  sourceType: string;
  sourceId: string;
  confidence: number;
  active: boolean;
  supersedesId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentSessionRecord = {
  id: string;
  livingTaskId: string;
  ownerSessionId: string;
  provider: ProviderId;
  model: string;
  providerSessionId: string | null;
  status: AgentSessionStatus;
  contextVersion: number;
  checkpointJson: unknown | null;
  createdAt: string;
  updatedAt: string;
};

export type TriggerSubscriptionRecord = {
  id: string;
  ownerSessionId: string;
  livingTaskId: string;
  type: TriggerType;
  enabled: boolean;
  configJson: Record<string, unknown>;
  nextDueAt: string | null;
  lastFiredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WakeEventRecord = {
  id: string;
  ownerSessionId: string;
  livingTaskId: string;
  triggerId: string;
  eventKey: string;
  type: TriggerType;
  status: WakeEventStatus;
  payloadJson: Record<string, unknown>;
  claimedBy: string | null;
  claimedAt: string | null;
  processedAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VerifiedContactRecord = {
  id: string;
  ownerSessionId: string;
  emailAddress: string;
  displayName: string | null;
  autoReplyEnabled: boolean;
  verifiedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskEvidenceRecord = {
  id: string;
  ownerSessionId: string;
  projectId: string | null;
  livingTaskId: string | null;
  sourceType: string;
  sourceId: string;
  category: string;
  summary: string;
  status: string | null;
  observedAt: string;
  confidence: number;
  milestoneWeight: number | null;
  milestoneProgress: number | null;
  metadataJson: Record<string, unknown>;
  createdAt: string;
};
