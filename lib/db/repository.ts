import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { ExecutionMode, ProviderMetadata, SessionActor, WorkflowAnalysis, WorkflowStatus } from "../domain/types";
import { SettingsRepository } from "./settings-repository";

export type WorkflowRecord = {
  ownerSessionId: string;
  id: string; livingTaskId: string | null; sourceName: string; sourceMime: string | null; sourceSha256: string | null; sourcePath: string | null; sourceText: string | null;
  status: WorkflowStatus; executionMode: ExecutionMode; preExecutionEnabled: boolean; analysis: WorkflowAnalysis | null; provider: ProviderMetadata | null;
  errorCode: string | null; errorMessage: string | null; version: number; createdAt: string; updatedAt: string;
};
export type NewWorkflow = { id?: string; ownerSessionId?: string; livingTaskId?: string | null; sourceName: string; sourceMime?: string; sourceSha256?: string; sourcePath?: string; sourceText?: string; executionMode?: ExecutionMode; preExecutionEnabled?: boolean };
export type ApprovalRecord = { id: string; workflowId: string; nodeId: string; kind: "CONFIRM" | "APPROVAL"; status: "PENDING" | "APPROVED" | "REJECTED"; version: number; workflowVersion: number; policyVersion: number; resolvedBy: string | null };
export type ResolveApprovalInput = { approvalId: string; expectedVersion: number; decision: "APPROVED" | "REJECTED"; actor: SessionActor };
export type ResolveApprovalResult = { type: "resolved"; approval: ApprovalRecord } | { type: "conflict" };
type WorkflowRow = {
  owner_session_id: string;
  id: string; living_task_id: string | null; source_name: string; source_mime: string | null; source_sha256: string | null; source_path: string | null; source_text: string | null;
  status: WorkflowStatus; execution_mode: ExecutionMode; pre_execution_enabled: number; analysis_json: string | null; provider_json: string | null;
  error_code: string | null; error_message: string | null; version: number; created_at: string; updated_at: string;
};
type ApprovalRow = { id: string; workflow_id: string; node_id: string; kind: "CONFIRM" | "APPROVAL"; status: "PENDING" | "APPROVED" | "REJECTED"; version: number; workflow_version: number; policy_version: number; resolved_by: string | null };
function workflowFromRow(row: WorkflowRow): WorkflowRecord {
  return { ownerSessionId:row.owner_session_id, id: row.id, livingTaskId: row.living_task_id ?? null, sourceName: row.source_name, sourceMime: row.source_mime, sourceSha256: row.source_sha256, sourcePath: row.source_path, sourceText: row.source_text,
    status: row.status, executionMode: row.execution_mode, preExecutionEnabled: row.pre_execution_enabled === 1,
    analysis: row.analysis_json ? JSON.parse(row.analysis_json) as WorkflowAnalysis : null,
    provider: row.provider_json ? JSON.parse(row.provider_json) as ProviderMetadata : null,
    errorCode: row.error_code, errorMessage: row.error_message, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at };
}
function approvalFromRow(row: ApprovalRow): ApprovalRecord {
  return { id: row.id, workflowId: row.workflow_id, nodeId: row.node_id, kind: row.kind, status: row.status, version: row.version, workflowVersion: row.workflow_version, policyVersion: row.policy_version, resolvedBy: row.resolved_by };
}

export class WorkflowRepository extends SettingsRepository {
  constructor(db: Database.Database) { super(db); }

  createWorkflow(input: NewWorkflow): WorkflowRecord {
    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO workflows(id,owner_session_id,living_task_id,source_name,source_mime,source_sha256,source_path,source_text,status,execution_mode,pre_execution_enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'DRAFT',?,?,?,?)")
      .run(id, input.ownerSessionId ?? "actflow-local-demo", input.livingTaskId ?? null, input.sourceName, input.sourceMime ?? null, input.sourceSha256 ?? null, input.sourcePath ?? null, input.sourceText ?? null, input.executionMode ?? "MANUAL", Number(input.preExecutionEnabled ?? false), now, now);
    return this.getWorkflow(id)!;
  }

  getWorkflow(id: string): WorkflowRecord | null {
    const row = this.db.prepare("SELECT * FROM workflows WHERE id=?").get(id) as WorkflowRow | undefined;
    return row ? workflowFromRow(row) : null;
  }

  createApproval(input: { id?: string; workflowId: string; nodeId: string; kind: "CONFIRM" | "APPROVAL"; policyVersion: number }): ApprovalRecord {
    const workflow = this.getWorkflow(input.workflowId);
    if (!workflow) throw new Error("Workflow not found");
    const id = input.id ?? randomUUID();
    this.db.prepare("INSERT INTO approvals(id,workflow_id,node_id,kind,status,version,workflow_version,policy_version,created_at) VALUES (?,?,?,?,'PENDING',0,?,?,?)")
      .run(id, input.workflowId, input.nodeId, input.kind, workflow.version, input.policyVersion, new Date().toISOString());
    return this.getApproval(id)!;
  }

  getApproval(id: string): ApprovalRecord | null {
    const row = this.db.prepare("SELECT * FROM approvals WHERE id=?").get(id) as ApprovalRow | undefined;
    return row ? approvalFromRow(row) : null;
  }

  resolveApproval(input: ResolveApprovalInput): ResolveApprovalResult {
    return this.db.transaction(() => {
      const current = this.getApproval(input.approvalId);
      if (!current || current.status !== "PENDING" || current.version !== input.expectedVersion) return { type: "conflict" } as const;
      if (current.kind === "APPROVAL" && input.actor.role !== "APPROVER") return { type: "conflict" } as const;
      const workflow = this.getWorkflow(current.workflowId);
      if (!workflow || workflow.status !== "WAITING" || workflow.version !== current.workflowVersion) return { type: "conflict" } as const;
      if (this.getSettings().organizationPolicyVersion !== current.policyVersion) return { type: "conflict" } as const;
      const update = this.db.prepare("UPDATE approvals SET status=?,version=version+1,resolved_by=?,resolved_role=?,resolved_at=? WHERE id=? AND status='PENDING' AND version=?")
        .run(input.decision, input.actor.id, input.actor.role, new Date().toISOString(), input.approvalId, input.expectedVersion);
      if (update.changes !== 1) return { type: "conflict" } as const;
      return { type: "resolved", approval: this.getApproval(input.approvalId)! } as const;
    })();
  }
}
