import { getEpisodeContext } from "../tasks/episode-context";
import { reconcileTaskFromWorkflow } from "../tasks/lifecycle";
import {withTaskLease,assertTaskLease,TaskConflictError} from "../tasks/lease";
import { createHash, randomUUID } from "node:crypto";
import type { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import type Database from "better-sqlite3";
import { ArtifactWorkspace, type ArtifactRecord, type RollbackResult } from "../artifacts/workspace";
import type { ParticipantRow } from "../artifacts/xlsxGenerator";
import { FlightRecorder } from "../audit/recorder";
import type { RecorderEvent } from "../audit/types";
import { WorkflowRepository, type ApprovalRecord, type WorkflowRecord } from "../db/repository";
import type { SessionActor, WorkflowAnalysis, WorkflowTask } from "../domain/types";
import { builtInPolicySet } from "../policy/defaultPolicies";
import type { PolicySet } from "../policy/types";
import { executeTool, getTool } from "../tools/registry";
import type { ToolResult } from "../tools/types";
import { buildWorkflowGraph, topologicalTasks, type GraphNode } from "./builder";
import { transitionNode, transitionWorkflow } from "./state-machine";
import { verifyArtifact, type ArtifactGoal } from "./verifier";
import type { ResponseDocumentInput } from "../artifacts/docxGenerator";
import { RuntimeAnalysisResultSchema } from "../providers/schemas";
import { DomainError, getDomainErrorKind } from "../domain/errors";

export type AnalyzeInput = { workflowId: string; sourceText: string; sourceName: string; locale?: string };
export type WorkflowAnalyzer = (input: AnalyzeInput) => Promise<WorkflowAnalysis>;
export type MailPreview = { to: string; subject: string; body: string; attachments: Array<{ id: string; name: string }>; actual: boolean };
export type WorkflowSnapshot = { workflow: WorkflowRecord; nodes: GraphNode[]; edges: WorkflowAnalysis["edges"]; approvals: ApprovalRecord[]; artifacts: ArtifactRecord[]; events: RecorderEvent[]; mailPreview?: MailPreview };
export type AnalyzeWorkflowResult = { snapshot: WorkflowSnapshot; executedActions: 0; message: "아직 실행된 작업이 없습니다." };
export type AnalyzeWorkflowOptions = Pick<WorkflowRecord, "executionMode" | "preExecutionEnabled">;
export class WorkflowConflictError extends DomainError {
  constructor(message = "워크플로 상태가 변경되었습니다.") { super("WORKFLOW_CONFLICT", message); this.name = "WorkflowConflictError"; }
}
type NodeRow = { id: string; workflow_id: string; title: string; kind: GraphNode["kind"]; action_type: string; status: GraphNode["status"]; policy_class: GraphNode["policyClass"]; policy_json: string; task_json: string; result_json: string | null; error_message: string | null };
const workflowOperations = new WeakMap<Database.Database, Set<string>>();

export class WorkflowEngine {
  private readonly operations: Set<string>;
  private episodeCompletionHandler?: (snapshot: WorkflowSnapshot) => Promise<void>;

  /** Application wiring only, never supplied by a model or public request. Runs under the task lease. */
  setEpisodeCompletionHandler(handler: (snapshot: WorkflowSnapshot) => Promise<void>): void {
    this.episodeCompletionHandler = handler;
  }

  async compensateFailedEpisode(workflowId:string,actor:SessionActor):Promise<RollbackResult> {
    const workflow=this.workflow(workflowId);
    if(workflow.ownerSessionId!==actor.sessionId||workflow.status!=="FAILED")throw new WorkflowConflictError("실패한 본인 실행만 복구할 수 있습니다.");
    return this.withOperation(workflowId,()=>this.workspace.compensateFailedEpisode(workflowId),true);
  }

  /** Explicit recovery only: READY proves no send was claimed. Reopen confirmation, never resend here. */
  async restoreUnsentMailApproval(workflowId:string,actor:SessionActor):Promise<WorkflowSnapshot> {
    return this.withOperation(workflowId,async()=>{
      const snapshot=this.getSnapshot(workflowId),node=snapshot.nodes[0];
      const outbox=this.db.prepare("SELECT 1 FROM mail_outbox WHERE workflow_id=? AND owner_session_id=? AND status='READY'").get(workflowId,actor.sessionId);
      if(snapshot.workflow.ownerSessionId!==actor.sessionId||snapshot.workflow.status!=='FAILED'||snapshot.workflow.errorCode==='DECISION_REJECTED'||!outbox||snapshot.nodes.length!==1||node.actionType!=='external.email.send'||snapshot.approvals.some(a=>a.status==='REJECTED'))throw new WorkflowConflictError('발송하지 않은 메일만 다시 확인할 수 있습니다.');
      this.assertCurrentPolicy(workflowId);
      this.db.transaction(()=>{
        this.db.prepare("UPDATE workflows SET status='WAITING',error_code=NULL,error_message=NULL,version=version+1,updated_at=? WHERE id=?").run(new Date().toISOString(),workflowId);
        this.db.prepare("UPDATE workflow_nodes SET status='WAITING',result_json=NULL,error_message=NULL WHERE workflow_id=? AND id=?").run(workflowId,node.id);
        const existing=snapshot.approvals[0];
        if(existing)this.db.prepare("UPDATE approvals SET status='PENDING',version=version+1,workflow_version=?,resolved_by=NULL,resolved_role=NULL,resolved_at=NULL WHERE id=?").run(this.workflow(workflowId).version,existing.id);
        else this.repo.createApproval({workflowId,nodeId:node.id,kind:node.policyClass==='APPROVAL'?'APPROVAL':'CONFIRM',policyVersion:node.policy.policyVersion});
        this.db.prepare('UPDATE mail_outbox SET requires_approval=1 WHERE workflow_id=?').run(workflowId);
        this.recorder.appendRecorderEvent({workflowId,eventType:'UNSENT_MAIL_CONFIRMATION_REOPENED',actor:actor.id,externalEffect:'NONE',details:{sendAttempted:false}});
      })();
      return this.getSnapshot(workflowId);
    });
  }

  /** Drain only persisted follow-up work; never rerun a completed tool episode. */
  async finalizeCompletedEpisode(workflowId: string, actor: SessionActor): Promise<void> {
    const workflow = this.workflow(workflowId);
    if (workflow.ownerSessionId !== actor.sessionId || workflow.status !== 'COMPLETED' || !workflow.livingTaskId) throw new WorkflowConflictError('완료된 본인 작업만 복원할 수 있습니다.');
    await withTaskLease(this.db, workflow.livingTaskId, actor.sessionId, () => this.settleTask(workflowId, true));
  }

  /** Recover persisted confirmations/checkpoints only. This method never invokes a work tool. */
  async recoverInterruptedExecution(workflowId: string, actor: SessionActor): Promise<WorkflowSnapshot> {
    const owned = this.workflow(workflowId);
    if (owned.ownerSessionId !== actor.sessionId || !owned.livingTaskId) throw new WorkflowConflictError('실행 복원 범위가 다릅니다.');
    return this.withOperation(workflowId, async () => {
      const snapshot = this.getSnapshot(workflowId);
      if (snapshot.workflow.status !== 'RUNNING') return snapshot;
      let uncertain = false;
      this.db.transaction(() => {
        for (const node of snapshot.nodes.filter(item => ['RUNNING','PREPARING'].includes(item.status))) {
          const outbox = node.actionType === 'external.email.send'
            ? this.db.prepare('SELECT id,status,result_json FROM mail_outbox WHERE workflow_id=? AND living_task_id=? AND owner_session_id=?')
              .get(workflowId, owned.livingTaskId, actor.sessionId) as {id:string;status:string;result_json:string|null}|undefined : undefined;
          let receipt: {ok?:unknown;sent?:unknown;messageId?:unknown;externalEffect?:unknown;remoteVerified?:unknown}|null = null;
          try { receipt = outbox?.result_json ? JSON.parse(outbox.result_json) : null; } catch { /* Invalid receipts are not confirmation. */ }
          if (outbox?.status === 'SENT' && receipt?.ok === true && receipt.sent === true && typeof receipt.messageId === 'string'
              && receipt.messageId.length > 0 && receipt.messageId.length <= 500 && !/[\r\n\0]/.test(receipt.messageId)
              && ['SIMULATED','ACTUAL'].includes(String(receipt.externalEffect)) && (receipt.externalEffect!=='ACTUAL'||receipt.remoteVerified===true)) {
            const effect = receipt.externalEffect as 'SIMULATED'|'ACTUAL';
            this.setNodeResult(workflowId,node.id,{toolResult:{ok:true,sent:true,filesCreated:[],dataRead:[],fieldsRead:[],fieldsExcluded:[],
              externalSideEffect:effect==='ACTUAL',externalEffect:effect,reversible:false,evidence:{messageId:receipt.messageId,recoveredFrom:'durable-outbox'}}});
            this.setNodeStatus(workflowId,node.id,'COMPLETED'); this.setNodeStatus(workflowId,node.id,'VERIFIED');
            this.db.prepare('INSERT INTO verifications(id,workflow_id,node_id,passed,verifier_version,evidence_json,created_at) VALUES (?,?,?,?,?,?,?)')
              .run(randomUUID(),workflowId,node.id,1,'actflow-mail-send-v1',JSON.stringify({sent:true,messageId:receipt.messageId,externalEffect:effect,recovered:true}),new Date().toISOString());
            this.recorder.appendRecorderEvent({workflowId,nodeId:node.id,eventType:'VERIFICATION',actor:'actflow-recovery',action:node.actionType,
              verificationStatus:'VERIFIED',externalEffect:effect,details:{messageId:receipt.messageId,recoveredFrom:'durable-outbox',resent:false}});
          } else if (node.actionType === 'employee.lookup' || (node.actionType === 'external.email.send' && outbox?.status === 'READY')) {
            // A read-only lookup can be repeated; READY proves the send transport was not claimed.
            // Restore to a paused checkpoint so the next explicit execution still encounters policy gates.
            this.db.prepare("UPDATE workflow_nodes SET status='READY',result_json=NULL,error_message=NULL WHERE workflow_id=? AND id=? AND status IN ('RUNNING','PREPARING')").run(workflowId,node.id);
          } else {
            uncertain = true;
            if (outbox?.status === 'SENDING') this.db.prepare("UPDATE mail_outbox SET status='UNKNOWN',updated_at=? WHERE id=? AND status='SENDING'").run(new Date().toISOString(),outbox.id);
            this.setNodeStatus(workflowId,node.id,'FAILED');
          }
        }
        if (uncertain) {
          this.setWorkflowStatus(workflowId,'FAILED');
          this.db.prepare("UPDATE workflows SET error_code='INTERRUPTED_OUTCOME_UNKNOWN',error_message=? WHERE id=?").run('중단된 실행의 결과를 확인할 수 없어 자동 반복을 차단했습니다.',workflowId);
          this.db.prepare("UPDATE living_tasks SET status='BLOCKED',waiting_reason=?,version=version+1,updated_at=? WHERE id=? AND owner_session_id=? AND status NOT IN ('PAUSED','CANCELLED','COMPLETED','BLOCKED')")
            .run('중단된 실행의 실제 결과를 확인해야 합니다. 확인되지 않은 메일은 재발송하지 않았습니다.',new Date().toISOString(),owned.livingTaskId,actor.sessionId);
        } else if (this.getSnapshot(workflowId).nodes.every(node => ['COMPLETED','VERIFIED'].includes(node.status))) {
          this.setWorkflowStatus(workflowId,'COMPLETED');
        } else {
          this.setWorkflowStatus(workflowId,'PAUSED');
          this.db.prepare("UPDATE living_tasks SET waiting_reason=? WHERE id=? AND owner_session_id=?")
            .run('서버 재시작 전 확인된 결과를 복원했습니다. 재개하면 남은 단계부터 정책 검사를 거칩니다.',owned.livingTaskId,actor.sessionId);
        }
        this.recorder.appendRecorderEvent({workflowId,eventType:'EXECUTION_RECOVERED',actor:'actflow-recovery',externalEffect:'NONE',details:{uncertain,toolsRerun:0,status:this.workflow(workflowId).status}});
      })();
      return this.getSnapshot(workflowId);
    });
  }

  async recoverInterruptedExecutions(limit = 50): Promise<number> {
    const rows = this.db.prepare(`SELECT w.id,w.owner_session_id FROM workflows w JOIN living_tasks t
      ON t.id=w.living_task_id AND t.owner_session_id=w.owner_session_id AND t.current_workflow_id=w.id
      WHERE w.status='RUNNING' AND t.status NOT IN ('PAUSED','BLOCKED','CANCELLED','COMPLETED')
      AND (t.lease_owner IS NULL OR t.lease_expires_at<=?) ORDER BY w.updated_at LIMIT ?`)
      .all(new Date().toISOString(),Math.max(1,Math.min(limit,200))) as Array<{id:string;owner_session_id:string}>;
    let count=0;
    for (const row of rows) {
      try { await this.recoverInterruptedExecution(row.id,{id:'actflow-recovery',sessionId:row.owner_session_id,role:'USER'}); count++; }
      catch (error) {
        if (!['TASK_CONFLICT','WORKFLOW_CONFLICT'].includes(getDomainErrorKind(error) ?? '')) this.recorder.appendRecorderEvent({workflowId:row.id,eventType:'RECOVERY_FAILED',actor:'actflow-recovery',externalEffect:'NONE',error:error instanceof Error?error.name:'UnknownError'});
      }
    }
    return count;
  }

  private async settleTask(workflowId: string, allowContinuation: boolean): Promise<void> {
    const snapshot = this.getSnapshot(workflowId);
    reconcileTaskFromWorkflow(this.db, snapshot);
    if (allowContinuation && snapshot.workflow.livingTaskId && snapshot.workflow.status === "COMPLETED") {
      await this.episodeCompletionHandler?.(snapshot);
    }
  }
  private readonly repo: WorkflowRepository;
  private readonly workspace: ArtifactWorkspace;
  private readonly recorder: FlightRecorder;
  constructor(private readonly db: Database.Database, private readonly dataDir: string, workspaceFs?: { unlink: typeof unlink }) {
    let operations = workflowOperations.get(db);
    if (!operations) { operations = new Set(); workflowOperations.set(db, operations); }
    this.operations = operations;
    this.repo = new WorkflowRepository(db);
    this.workspace = new ArtifactWorkspace(db, dataDir, workspaceFs);
    this.recorder = new FlightRecorder(db);
  }

  private async withOperation<T>(workflowId: string, operation: () => Promise<T>, cleanupOnly = false): Promise<T> {
    if (this.operations.has(workflowId)) throw new WorkflowConflictError("이 워크플로의 변경 작업이 진행 중입니다. 완료 후 새 상태에서 다시 요청하세요.");
    this.operations.add(workflowId);
    try {
      const workflow=this.workflow(workflowId);
      const run = async () => {
        try {
          const result = await operation();
          await this.settleTask(workflowId, !cleanupOnly);
          return result;
        } catch (error) {
          // Preserve the original execution error and reconcile only the persisted state.
          try { await this.settleTask(workflowId, false); } catch { /* Never replace the execution error. */ }
          throw error;
        }
      };
      if (workflow.livingTaskId) return await withTaskLease(this.db, workflow.livingTaskId, workflow.ownerSessionId, async () => {
        if (!cleanupOnly) this.assertLinkedTaskCanRun(workflowId);
        return run();
      });
      return await run();
    }
    finally { this.operations.delete(workflowId); }
  }

  private assertLinkedTaskCanRun(workflowId:string):void {
    const workflow=this.workflow(workflowId);if(!workflow.livingTaskId)return;
    assertTaskLease(this.db,workflow.livingTaskId);
    const task=this.db.prepare("SELECT status,current_workflow_id FROM living_tasks WHERE id=? AND owner_session_id=?").get(workflow.livingTaskId,workflow.ownerSessionId) as {status:string;current_workflow_id:string|null}|undefined;
    if (task?.status === "PAUSED" && workflow.status === "RUNNING") {
      this.setWorkflowStatus(workflowId, "PAUSED");
      this.recorder.appendRecorderEvent({ workflowId, eventType: "PAUSED", actor: "actflow-engine", externalEffect: "NONE", details: { cooperativeBoundary: true } });
    }
    if(!task||["PAUSED","CANCELLED","COMPLETED","BLOCKED"].includes(task.status)||task.current_workflow_id!==workflowId)throw new TaskConflictError("작업이 보호 상태이거나 현재 실행이 아닙니다.");
  }

  private workflow(id: string): WorkflowRecord {
    const workflow = this.repo.getWorkflow(id);
    if (!workflow) throw new Error("워크플로를 찾을 수 없습니다.");
    return workflow;
  }

  private node(workflowId: string, nodeId: string): GraphNode {
    const row = this.db.prepare("SELECT * FROM workflow_nodes WHERE workflow_id=? AND id=?").get(workflowId, nodeId) as NodeRow | undefined;
    if (!row) throw new Error("워크플로 노드를 찾을 수 없습니다.");
    return { id: row.id, workflowId: row.workflow_id, title: row.title, kind: row.kind, actionType: row.action_type,
      status: row.status, policyClass: row.policy_class, policy: JSON.parse(row.policy_json),
      task: JSON.parse(row.task_json), result: row.result_json ? JSON.parse(row.result_json) : null, errorMessage: row.error_message };
  }

  getSnapshot(workflowId: string): WorkflowSnapshot {
    const workflow = this.workflow(workflowId);
    const rows = this.db.prepare("SELECT * FROM workflow_nodes WHERE workflow_id=? ORDER BY rowid").all(workflowId) as NodeRow[];
    const nodes = rows.map(row => this.node(workflowId, row.id));
    const edges = (this.db.prepare("SELECT from_id,to_id,condition FROM workflow_edges WHERE workflow_id=? ORDER BY rowid").all(workflowId) as Array<{ from_id: string; to_id: string; condition: WorkflowAnalysis["edges"][number]["condition"] }>)
      .map(row => ({ from: row.from_id, to: row.to_id, condition: row.condition }));
    const approvalRows = this.db.prepare("SELECT id FROM approvals WHERE workflow_id=? ORDER BY created_at,rowid").all(workflowId) as Array<{ id: string }>;
    const outbox=this.db.prepare('SELECT draft_json FROM mail_outbox WHERE workflow_id=? AND owner_session_id=?').get(workflowId,workflow.ownerSessionId) as {draft_json:string}|undefined;
    const draft=outbox?JSON.parse(outbox.draft_json) as {to:string;subject:string;body:string;artifactIds:string[]}:null;
    const mailPreview:MailPreview|undefined=draft?{to:draft.to,subject:draft.subject,body:draft.body,actual:process.env.ACTFLOW_TEST_MODE!=='true'||process.env.NODE_ENV==='production',attachments:draft.artifactIds.map(id=>({id,name:this.workspace.getArtifact(id)?.displayName??'첨부파일'}))}:undefined;
    return { workflow, nodes, edges, approvals: approvalRows.map(row => this.repo.getApproval(row.id)!), artifacts: this.workspace.listArtifacts(workflowId), events: this.recorder.listRecorderEvents(workflowId), ...(mailPreview?{mailPreview}:{}) };
  }

  private policySet(): PolicySet {
    const version = this.repo.getSettings().organizationPolicyVersion;
    const base = builtInPolicySet(version);
    const row = this.db.prepare("SELECT policy_json FROM organization_profiles WHERE active=1 ORDER BY version DESC LIMIT 1").get() as { policy_json: string } | undefined;
    if (!row) return base;
    const parsed = JSON.parse(row.policy_json) as { rules?: PolicySet["rules"] };
    return { version, rules: [...base.rules, ...(parsed.rules ?? [])] };
  }

  async analyzeWorkflow(workflowId: string, analyzer: WorkflowAnalyzer, options?: AnalyzeWorkflowOptions): Promise<AnalyzeWorkflowResult> {
    return this.withOperation(workflowId, () => this.analyzeUnlocked(workflowId, analyzer, options));
  }

  private async analyzeUnlocked(workflowId: string, analyzer: WorkflowAnalyzer, options?: AnalyzeWorkflowOptions): Promise<AnalyzeWorkflowResult> {
    const workflow = this.workflow(workflowId);
    if (workflow.status !== "DRAFT" || !workflow.sourceText) throw new WorkflowConflictError("분석할 원문이 없거나 이미 분석되었습니다.");
    const selection = options ? { ...options } : { executionMode: workflow.executionMode, preExecutionEnabled: workflow.preExecutionEnabled };
    if (options && ((selection.executionMode === "PRE_EXECUTION") !== selection.preExecutionEnabled)) throw new WorkflowConflictError("사전 실행 모드와 설정이 일치하지 않습니다.");
    let analysis: WorkflowAnalysis;
    let graph: ReturnType<typeof buildWorkflowGraph>;
    try {
      analysis = RuntimeAnalysisResultSchema.parse(await analyzer({ workflowId, sourceText: workflow.sourceText, sourceName: workflow.sourceName, locale: "ko" }));
      this.assertLinkedTaskCanRun(workflowId);
      if (analysis.emailReply) {
        const binding = getEpisodeContext(this.db, workflowId, workflow.ownerSessionId);
        if (!workflow.livingTaskId || !binding?.inbound_message_id || binding.living_task_id !== workflow.livingTaskId) {
          throw new WorkflowConflictError("수신 메일에 연결되지 않은 답장 계획입니다.");
        }
      }
      graph = buildWorkflowGraph(analysis, this.policySet());
    }
    catch (error) {
      this.db.prepare("UPDATE workflows SET error_code='PROVIDER_ERROR',error_message=?,updated_at=? WHERE id=?")
        .run("분석 제공자가 문서를 처리하지 못했습니다.", new Date().toISOString(), workflowId);
      this.recorder.appendRecorderEvent({ workflowId, eventType: "PROVIDER_FAILED", actor: "system", externalEffect: "NONE", error: error instanceof Error ? error.name : "ProviderError" });
      throw error;
    }
    this.db.transaction(() => {
      transitionWorkflow(workflow.status, "ANALYZED");
      if (workflow.livingTaskId) this.db.prepare("UPDATE task_episode_context SET reply_status=?,updated_at=? WHERE workflow_id=? AND owner_session_id=?")
        .run(analysis.emailReply ? "PENDING" : "NONE", new Date().toISOString(), workflowId, workflow.ownerSessionId);
      for (const fact of analysis.facts) this.db.prepare("INSERT INTO facts(id,workflow_id,fact_key,fact_value,confidence,source,quote_or_locator) VALUES (?,?,?,?,?,?,?)")
        .run(randomUUID(), workflowId, fact.key, fact.value, fact.confidence, fact.evidence?.source ?? null, fact.evidence?.quoteOrLocator ?? null);
      for (const node of graph.nodes) {
        this.db.prepare("INSERT INTO workflow_nodes(id,workflow_id,title,kind,action_type,status,policy_class,policy_json,task_json,expected_output) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .run(node.id, workflowId, node.title, node.kind, node.actionType, node.status, node.policyClass, JSON.stringify(node.policy), JSON.stringify(node.task), node.task.expectedOutput);
        this.db.prepare("INSERT INTO policy_decisions(id,workflow_id,node_id,policy_class,policy_version,matched_rules_json,model_suggestion,override_reason,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
          .run(randomUUID(), workflowId, node.id, node.policyClass, node.policy.policyVersion, JSON.stringify(node.policy.matchedRules), node.policy.modelSuggestion, node.policy.overrideReason, new Date().toISOString());
      }
      for (const edge of graph.edges) this.db.prepare("INSERT INTO workflow_edges(workflow_id,from_id,to_id,condition) VALUES (?,?,?,?)").run(workflowId, edge.from, edge.to, edge.condition);
      const update = this.db.prepare("UPDATE workflows SET status='ANALYZED',analysis_json=?,provider_json=?,execution_mode=?,pre_execution_enabled=?,error_code=NULL,error_message=NULL,version=version+1,updated_at=? WHERE id=? AND status='DRAFT' AND version=?")
        .run(JSON.stringify(analysis), JSON.stringify(analysis.provider), selection.executionMode, Number(selection.preExecutionEnabled), new Date().toISOString(), workflowId, workflow.version);
      if (update.changes !== 1) throw new WorkflowConflictError();
    })();
    this.recorder.appendRecorderEvent({ workflowId, eventType: "ANALYZED", actor: "system", provider: analysis.provider.provider, model: analysis.provider.model,
      providerMode: analysis.provider.mode, realModelCalled: analysis.provider.realModelCalled, source: workflow.sourceName,
      externalEffect: "NONE", details: { executedActions: 0, message: "아직 실행된 작업이 없습니다." } });
    for (const node of graph.nodes) this.recorder.appendRecorderEvent({ workflowId, nodeId: node.id, eventType: "POLICY_DECISION", actor: "policy-engine",
      action: node.actionType, policyClass: node.policyClass, matchedRules: node.policy.matchedRules, policyVersion: node.policy.policyVersion,
      policyReason: node.policy.overrideReason ?? undefined, externalEffect: "NONE" });
    return { snapshot: this.getSnapshot(workflowId), executedActions: 0, message: "아직 실행된 작업이 없습니다." };
  }

  private setWorkflowStatus(workflowId: string, next: WorkflowRecord["status"]): void {
    const current = this.workflow(workflowId);
    transitionWorkflow(current.status, next);
    const changed = this.db.prepare("UPDATE workflows SET status=?,version=version+1,updated_at=? WHERE id=? AND status=? AND version=?")
      .run(next, new Date().toISOString(), workflowId, current.status, current.version);
    if (changed.changes !== 1) throw new WorkflowConflictError();
  }

  private setNodeStatus(workflowId: string, nodeId: string, next: GraphNode["status"]): void {
    const current = this.node(workflowId, nodeId);
    transitionNode(current.status, next);
    const changed = this.db.prepare("UPDATE workflow_nodes SET status=?,started_at=CASE WHEN ?='RUNNING' THEN ? ELSE started_at END,finished_at=CASE WHEN ? IN ('COMPLETED','VERIFIED','FAILED','BLOCKED','ROLLED_BACK') THEN ? ELSE finished_at END WHERE workflow_id=? AND id=? AND status=?")
      .run(next, next, new Date().toISOString(), next, new Date().toISOString(), workflowId, nodeId, current.status);
    if (changed.changes !== 1) throw new WorkflowConflictError();
  }

  private setNodeResult(workflowId: string, nodeId: string, result: Record<string, unknown>): void {
    this.db.prepare("UPDATE workflow_nodes SET result_json=? WHERE workflow_id=? AND id=?").run(JSON.stringify(result), workflowId, nodeId);
  }

  private facts(workflow: WorkflowRecord): Record<string, string> {
    return Object.fromEntries((workflow.analysis?.facts ?? []).map(fact => [fact.key, fact.value]));
  }

  private participants(workflowId: string): ParticipantRow[] {
    const lookup = this.getSnapshot(workflowId).nodes.find(node => node.actionType === "employee.lookup");
    const data = (lookup?.result?.toolResult as ToolResult | undefined)?.data;
    return Array.isArray(data) ? data as ParticipantRow[] : [];
  }

  private argsFor(task: WorkflowTask, workflow: WorkflowRecord): unknown {
    if (task.actionType === "employee.lookup") return { eligibleOnly: true };
    if (task.actionType === "artifact.xlsx.participants") return {};
    if (task.actionType === "artifact.docx.response") {
      const facts = this.facts(workflow);
      return { title: "AI 교육 참석 회신", recipient: facts.sender ?? "교육 운영팀",
        body: "AI 교육 참가 대상자 명단을 제출합니다.", participantCount: this.participants(workflow.id).length,
        expenseKrw: Number(facts.expenseKrw ?? 0) };
    }
    if (task.actionType === "demo.email.simulate") return { recipient: this.facts(workflow).sender ?? "교육 운영팀" };
    if (task.actionType === "external.email.send") {
      const facts = this.facts(workflow);
      return {
        recipient: facts.emailTo ?? "",
        subject: facts.emailSubject ?? "",
        body: facts.emailBody ?? "",
        threadId: facts.emailThreadId || null,
        livingTaskId: workflow.livingTaskId ?? ""
      };
    }
    return {};
  }

  private preparationKey(workflow: WorkflowRecord, task: WorkflowTask, args: unknown): string {
    const tool = getTool(task.actionType);
    const sourceHash = workflow.sourceSha256 ?? createHash("sha256").update(workflow.sourceText ?? "").digest("hex");
    return createHash("sha256").update(JSON.stringify({
      sourceHash, task, args, participants: task.actionType === "artifact.xlsx.participants" ? this.participants(workflow.id) : undefined,
      toolVersion: tool.version, policyVersion: this.policySet().version
    })).digest("hex");
  }

  private async prepareArtifacts(workflowId: string, gateId: string): Promise<void> {
    const workflow = this.workflow(workflowId);
    for (const task of topologicalTasks(workflow.analysis!.tasks)) {
      if (!task.dependsOn.includes(gateId) || !task.actionType.startsWith("artifact.")) continue;
      if (task.dependsOn.some(dependency => dependency !== gateId && !["COMPLETED", "VERIFIED"].includes(this.node(workflowId, dependency).status))) continue;
      const node = this.node(workflowId, task.id);
      const tool = getTool(task.actionType);
      if (node.policyClass !== "AUTO" || tool.externalSideEffect || !tool.reversible) continue;
      const args = this.argsFor(task, workflow);
      const key = this.preparationKey(workflow, task, args);
      this.setNodeStatus(workflowId, task.id, "PREPARING");
      try {
      const result = await executeTool(task.actionType, args, { workflowId, nodeId: task.id, workspace: this.workspace,
        participantRows: this.participants(workflowId), preparationKey: key });
      if (!result.ok) throw new Error("Preparation tool returned failure");
      this.setNodeResult(workflowId, task.id, { toolResult: result, preparationKey: key });
      this.setNodeStatus(workflowId, task.id, "WAITING");
      this.recorder.appendRecorderEvent({ workflowId, nodeId: task.id, eventType: "PREPARED", actor: "actflow-engine",
        action: task.actionType, policyClass: node.policyClass, policyVersion: node.policy.policyVersion,
        temporaryArtifactIds: result.artifactId ? [result.artifactId] : [], generatedFiles: result.filesCreated, externalEffect: "NONE",
        details: { state: "PREPARED_NOT_COMMITTED" } });
      } catch (error) {
        this.failTask(workflowId, task, error, "PREPARATION_FAILED");
        throw error;
      }
    }
  }

  private failTask(workflowId: string, task: WorkflowTask, error: unknown, eventType = "TOOL_FAILED"): void {
    this.setNodeStatus(workflowId, task.id, "FAILED");
    this.setWorkflowStatus(workflowId, "FAILED");
    this.db.prepare("UPDATE workflows SET error_code=?,error_message=? WHERE id=?")
      .run(eventType, "작업이 실패했습니다. 실행 기록과 남아 있는 결과를 확인하세요.", workflowId);
    this.recorder.appendRecorderEvent({ workflowId, nodeId: task.id, eventType, actor: "actflow-engine",
      action: task.actionType, externalEffect: "NONE", error: error instanceof Error ? error.name : "Unknown tool error" });
  }

  private async runAutoNode(workflowId: string, task: WorkflowTask, approvalId?: string): Promise<void> {
    this.assertLinkedTaskCanRun(workflowId);
    const workflow = this.workflow(workflowId);
    const node = this.node(workflowId, task.id);
    const prepared = node.status === "WAITING" ? node.result : null;
    this.setNodeStatus(workflowId, task.id, "RUNNING");
    try {
      const args = this.argsFor(task, workflow);
      const key = task.actionType.startsWith("artifact.") ? this.preparationKey(workflow, task, args) : null;
      let result: ToolResult;
      let reused = false;
      if (prepared && key && prepared.preparationKey === key) {
        result = prepared.toolResult as ToolResult;
        const artifact = result.artifactId ? this.workspace.getArtifact(result.artifactId) : null;
        reused = artifact?.state === "TEMPORARY" && artifact.preparationKey === key;
      } else result = {} as ToolResult;
      if (!reused) result = await executeTool(task.actionType, args, { workflowId, nodeId: task.id,
        workspace: this.workspace, participantRows: this.participants(workflowId), preparationKey: key ?? undefined, db: this.db, dataDir:this.dataDir });
      if (!result.ok) throw new Error("Registered tool returned failure");
      this.setNodeResult(workflowId, task.id, { toolResult: result, preparationKey: key, reusedPrepared: reused });
      this.recorder.appendRecorderEvent({ workflowId, nodeId: task.id, eventType: "TOOL_EXECUTED", actor: "actflow-engine",
        action: task.actionType, purpose: task.title, dataRead: result.dataRead, fieldsRead: result.fieldsRead, fieldsExcluded: result.fieldsExcluded,
        generatedFiles: result.filesCreated, policyClass: node.policyClass, matchedRules: node.policy.matchedRules, policyVersion: node.policy.policyVersion,
        approvalId,
        externalEffect: result.externalEffect ?? (result.externalSideEffect ? "ACTUAL" : "NONE"), details: { reusedPrepared: reused, artifactId: result.artifactId ?? null, sent: result.sent ?? null } });
      if (task.actionType.startsWith("artifact.")) {
        if (!result.artifactId) throw new Error("Artifact tool returned no artifact");
        const artifact = this.workspace.getArtifact(result.artifactId);
        if (!artifact || artifact.state !== "TEMPORARY") throw new Error("Artifact is not in the staging area");
        const kind = task.actionType === "artifact.xlsx.participants" ? "xlsx" : "docx";
        const requiredTexts = kind === "xlsx" ? this.participants(workflowId).map(row => row.name) : ["AI 교육 참석 회신", this.facts(workflow).sender ?? "교육 운영팀"];
        const goal: ArtifactGoal = kind === "xlsx" ? { type: "participants", version: 1, rows: this.participants(workflowId) }
          : { type: "response", version: 1, ...args as ResponseDocumentInput };
        const verification = await verifyArtifact({ path: resolve(this.dataDir, artifact.relativePath), kind, requiredTexts, goal, expectedSha256: artifact.sha256 });
        this.db.prepare("INSERT INTO verifications(id,workflow_id,artifact_id,node_id,passed,verifier_version,evidence_json,created_at) VALUES (?,?,?,?,?,?,?,?)")
          .run(randomUUID(), workflowId, artifact.id, task.id, Number(verification.passed), verification.verifierVersion, JSON.stringify(verification), verification.checkedAt);
        this.db.prepare("UPDATE artifacts SET verification_status=? WHERE id=?").run(verification.passed ? "VERIFIED" : "FAILED", artifact.id);
        this.recorder.appendRecorderEvent({ workflowId, nodeId: task.id, eventType: "VERIFICATION", actor: "actflow-verifier",
          action: task.actionType, generatedFiles: [artifact.relativePath], verificationStatus: verification.passed ? "VERIFIED" : "FAILED",
          externalEffect: "NONE", details: { sha256: verification.sha256, size: verification.size, parsedStructure: verification.parsedStructure,
            goalHash: verification.evidence.goalHash, goalSatisfied: verification.goalSatisfied, predicates: verification.evidence.predicates, errorCode: verification.evidence.errorCode ?? null } });
        if (!verification.passed) throw new Error("Physical artifact verification failed");
        const committed = await this.workspace.commitTemporaryArtifact(artifact.id, verification.sha256!);
        this.recorder.appendRecorderEvent({ workflowId, nodeId: task.id, eventType: "ARTIFACT_COMMITTED", actor: "actflow-engine", action: task.actionType,
          generatedFiles: [committed.relativePath], verificationStatus: "VERIFIED", externalEffect: "NONE", details: { artifactId: committed.id, sha256: verification.sha256, goalHash: verification.evidence.goalHash } });
      } else if (task.actionType === "external.email.send") {
        const passed = result.sent === true && typeof result.evidence.messageId === "string" && result.evidence.messageId.length > 0;
        const checkedAt = new Date().toISOString();
        this.db.prepare("INSERT INTO verifications(id,workflow_id,node_id,passed,verifier_version,evidence_json,created_at) VALUES (?,?,?,?,?,?,?)")
          .run(randomUUID(), workflowId, task.id, Number(passed), "actflow-mail-send-v1", JSON.stringify({ sent: result.sent === true, messageId: result.evidence.messageId ?? null, externalEffect: result.externalEffect ?? null }), checkedAt);
        this.recorder.appendRecorderEvent({ workflowId, nodeId: task.id, eventType: "VERIFICATION", actor: "actflow-verifier", action: task.actionType, verificationStatus: passed ? "VERIFIED" : "FAILED", externalEffect: result.externalEffect ?? (result.externalSideEffect ? "ACTUAL" : "NONE"), details: { sent: result.sent === true, messageId: result.evidence.messageId ?? null } });
        if (!passed) throw new Error("Email send verification failed");
      } else {
        const rows = result.data;
        const passed = Array.isArray(rows) && rows.every(row => row && typeof row === "object" &&
          Object.keys(row as object).every(key => ["id", "name", "department", "title", "eligibleForTraining"].includes(key)));
        this.db.prepare("INSERT INTO verifications(id,workflow_id,node_id,passed,verifier_version,evidence_json,created_at) VALUES (?,?,?,?,?,?,?)")
          .run(randomUUID(), workflowId, task.id, Number(passed), "actflow-lookup-schema-v1", JSON.stringify({ rowCount: Array.isArray(rows) ? rows.length : null, projectedFieldsOnly: passed }), new Date().toISOString());
        if (!passed) throw new Error("Lookup projection verification failed");
      }
      this.setNodeStatus(workflowId, task.id, "COMPLETED");
      this.setNodeStatus(workflowId, task.id, "VERIFIED");
    } catch (error) {
      this.failTask(workflowId, task, error);
      if (task.actionType.startsWith("artifact.")) {
        const rollback = await this.workspace.rollbackTemporaryArtifacts(workflowId);
        if (rollback.status === "ROLLED_BACK") {
          for (const pending of this.getSnapshot(workflowId).nodes.filter(item => item.kind === "DOCUMENT_GENERATION" && item.status === "WAITING")) {
            this.setNodeStatus(workflowId, pending.id, "REJECTED");
            this.setNodeStatus(workflowId, pending.id, "ROLLED_BACK");
          }
          this.recorder.appendRecorderEvent({ workflowId, nodeId: task.id, eventType: "ROLLBACK_COMPLETED", actor: "actflow-engine", rollbackStatus: "ROLLED_BACK",
            externalEffect: "NONE", details: { reason: "ARTIFACT_VALIDATION_OR_COMMIT_FAILED", deleted: rollback.deleted, remainingFiles: [] } });
        }
      }
      throw error;
    }
  }

  private async runUntilGate(workflowId: string): Promise<WorkflowSnapshot> {
    this.assertLinkedTaskCanRun(workflowId);
    const workflow = this.workflow(workflowId);
    if (!workflow.analysis) throw new WorkflowConflictError("분석 결과가 없습니다.");
    for (const task of topologicalTasks(workflow.analysis.tasks)) {
      this.assertLinkedTaskCanRun(workflowId);
      const node = this.node(workflowId, task.id);
      if (["COMPLETED", "VERIFIED", "BLOCKED", "ROLLED_BACK"].includes(node.status)) continue;
      if (task.dependsOn.some(dependency => !["COMPLETED", "VERIFIED"].includes(this.node(workflowId, dependency).status))) continue;
      const unmetDecision = workflow.analysis.edges.filter(edge => edge.to === task.id && edge.condition !== "always").some(edge => {
        const kind = edge.condition === "approved" ? "APPROVAL" : edge.condition === "confirmed" ? "CONFIRM" : null;
        return !kind || !this.getSnapshot(workflowId).approvals.some(approval => approval.nodeId === edge.from && approval.kind === kind && approval.status === "APPROVED");
      });
      if (unmetDecision) continue;
      if (node.policyClass === "HUMAN_ONLY") {
        this.setNodeStatus(workflowId, task.id, "BLOCKED");
        this.setWorkflowStatus(workflowId, "WAITING");
        this.recorder.appendRecorderEvent({ workflowId, nodeId: task.id, eventType: "HUMAN_ONLY_BLOCKED", actor: "policy-engine",
          action: task.actionType, policyClass: "HUMAN_ONLY", matchedRules: node.policy.matchedRules, externalEffect: "NONE" });
        return this.getSnapshot(workflowId);
      }
      if (node.policyClass === "APPROVAL" || node.policyClass === "CONFIRM") {
        if (node.status !== "READY") throw new WorkflowConflictError("이미 결정 대기 중입니다.");
        if (workflow.preExecutionEnabled && node.policyClass === "APPROVAL") await this.prepareArtifacts(workflowId, task.id);
        this.setNodeStatus(workflowId, task.id, "WAITING");
        this.setWorkflowStatus(workflowId, "WAITING");
        const approval = this.repo.createApproval({ workflowId, nodeId: task.id, kind: node.policyClass, policyVersion: node.policy.policyVersion });
        this.recorder.appendRecorderEvent({ workflowId, nodeId: task.id, eventType: "DECISION_REQUIRED", actor: "actflow-engine",
          action: task.actionType, policyClass: node.policyClass, matchedRules: node.policy.matchedRules, policyVersion: node.policy.policyVersion,
          approvalId: approval.id, externalEffect: "NONE" });
        return this.getSnapshot(workflowId);
      }
      if (task.actionType === "workflow.complete" || task.actionType === "expense.process") {
        this.setNodeStatus(workflowId, task.id, "RUNNING");
        if (task.actionType === "expense.process") {
          this.setNodeResult(workflowId, task.id, { expenseReviewed: true, amountKrw: Number(this.facts(workflow).expenseKrw ?? 0), paymentExecuted: false });
          this.recorder.appendRecorderEvent({ workflowId, nodeId: task.id, eventType: "EXPENSE_REVIEWED", actor: "policy-engine", action: task.actionType, policyClass: node.policyClass, policyVersion: node.policy.policyVersion, externalEffect: "NONE", details: { paymentExecuted: false } });
        }
        this.setNodeStatus(workflowId, task.id, "COMPLETED");
        continue;
      }
      await this.runAutoNode(workflowId, task);
    }
    if (this.getSnapshot(workflowId).nodes.some(node => !["COMPLETED", "VERIFIED"].includes(node.status))) {
      this.setWorkflowStatus(workflowId, "WAITING");
      return this.getSnapshot(workflowId);
    }
    this.setWorkflowStatus(workflowId, "COMPLETED");
    this.recorder.appendRecorderEvent({ workflowId, eventType: "WORKFLOW_COMPLETED", actor: "actflow-engine", externalEffect: "NONE" });
    return this.getSnapshot(workflowId);
  }

  async executeWorkflow(workflowId: string, actor: SessionActor): Promise<WorkflowSnapshot> {
    return this.withOperation(workflowId, () => this.executeUnlocked(workflowId, actor));
  }

  private async executeUnlocked(workflowId: string, actor: SessionActor): Promise<WorkflowSnapshot> {
    const workflow = this.workflow(workflowId);
    this.assertCurrentPolicy(workflowId);
    if (workflow.status === "PAUSED") return this.resumeUnlocked(workflowId, actor);
    if (workflow.status !== "ANALYZED") throw new WorkflowConflictError("분석 완료 또는 일시정지 상태에서만 실행할 수 있습니다.");
    this.setWorkflowStatus(workflowId, "RUNNING");
    this.recorder.appendRecorderEvent({ workflowId, eventType: "EXECUTE_REQUESTED", actor: actor.id, externalEffect: "NONE",
      details: { mode: workflow.executionMode, preExecutionEnabled: workflow.preExecutionEnabled } });
    return this.runUntilGate(workflowId);
  }

  pauseWorkflow(workflowId: string, actor: SessionActor): WorkflowSnapshot {
    if (this.operations.has(workflowId)) throw new WorkflowConflictError("워크플로 변경 작업이 진행 중입니다.");
    const workflow = this.workflow(workflowId);
    if (workflow.status !== "ANALYZED" && workflow.status !== "WAITING") throw new WorkflowConflictError("현재 상태에서 일시정지할 수 없습니다.");
    this.setWorkflowStatus(workflowId, "PAUSED");
    this.recorder.appendRecorderEvent({ workflowId, eventType: "PAUSED", actor: actor.id, externalEffect: "NONE" });
    const snapshot = this.getSnapshot(workflowId);
    reconcileTaskFromWorkflow(this.db, snapshot);
    return snapshot;
  }

  async resumeWorkflow(workflowId: string, actor: SessionActor): Promise<WorkflowSnapshot> {
    return this.withOperation(workflowId, () => this.resumeUnlocked(workflowId, actor));
  }

  private async resumeUnlocked(workflowId: string, actor: SessionActor): Promise<WorkflowSnapshot> {
    this.assertCurrentPolicy(workflowId);
    if (this.workflow(workflowId).status !== "PAUSED") throw new WorkflowConflictError("일시정지된 워크플로가 아닙니다.");
    const pending = this.getSnapshot(workflowId).approvals.some(approval => approval.status === "PENDING");
    this.db.transaction(() => {
      this.setWorkflowStatus(workflowId, pending ? "WAITING" : "RUNNING");
      if (pending) this.db.prepare("UPDATE approvals SET workflow_version=?,version=version+1 WHERE workflow_id=? AND status='PENDING'")
        .run(this.workflow(workflowId).version, workflowId);
    })();
    this.recorder.appendRecorderEvent({ workflowId, eventType: "RESUMED", actor: actor.id, externalEffect: "NONE" });
    return pending ? this.getSnapshot(workflowId) : this.runUntilGate(workflowId);
  }

  private assertCurrentPolicy(workflowId: string): void {
    if (this.getSnapshot(workflowId).nodes.some(node => node.policy.policyVersion !== this.repo.getSettings().organizationPolicyVersion)) throw new WorkflowConflictError("정책이 변경되었습니다. 새 워크플로에서 다시 분석하세요.");
  }

  async discardTemporaryArtifacts(workflowId: string, actor: SessionActor): Promise<{ snapshot: WorkflowSnapshot; rollback: RollbackResult }> {
    // Cleanup is allowed on a protected parent task; it cannot execute a registered work tool.
    return this.withOperation(workflowId, () => this.discardUnlocked(workflowId, actor), true);
  }

  private async discardUnlocked(workflowId: string, actor: SessionActor): Promise<{ snapshot: WorkflowSnapshot; rollback: RollbackResult }> {
    const status = this.workflow(workflowId).status;
    if (!["WAITING", "PAUSED", "FAILED"].includes(status)) throw new WorkflowConflictError("임시 결과를 폐기할 수 있는 상태가 아닙니다.");
    this.db.transaction(() => {
      this.db.prepare("UPDATE workflows SET version=version+1,updated_at=? WHERE id=?").run(new Date().toISOString(), workflowId);
      this.db.prepare("UPDATE approvals SET workflow_version=?,version=version+1 WHERE workflow_id=? AND status='PENDING'")
        .run(this.workflow(workflowId).version, workflowId);
    })();
    const rollback = await this.workspace.rollbackTemporaryArtifacts(workflowId);
    if (rollback.status === "ROLLED_BACK") this.recorder.appendRecorderEvent({ workflowId, eventType: "ROLLBACK_COMPLETED", actor: actor.id,
      rollbackStatus: "ROLLED_BACK", externalEffect: "NONE", details: { deleted: rollback.deleted, remainingFiles: [] } });
    return { snapshot: this.getSnapshot(workflowId), rollback };
  }

  async resolveApproval(approvalId: string, decision: "APPROVED" | "REJECTED", expectedVersion: number, actor: SessionActor): Promise<WorkflowSnapshot> {
    const approval = this.repo.getApproval(approvalId);
    if (!approval) throw new WorkflowConflictError("결정 요청을 찾을 수 없습니다.");
    return this.withOperation(approval.workflowId, () => this.resolveApprovalUnlocked(approvalId, decision, expectedVersion, actor));
  }

  private async resolveApprovalUnlocked(approvalId: string, decision: "APPROVED" | "REJECTED", expectedVersion: number, actor: SessionActor): Promise<WorkflowSnapshot> {
    const pending = this.repo.getApproval(approvalId);
    if (!pending) throw new WorkflowConflictError("결정 요청을 찾을 수 없습니다.");
    if (this.repo.getSettings().organizationPolicyVersion !== pending.policyVersion) throw new WorkflowConflictError("정책 버전이 변경되었습니다.");
    const result = this.repo.resolveApproval({ approvalId, expectedVersion, decision, actor });
    if (result.type === "conflict") throw new WorkflowConflictError("중복 또는 오래된 승인 요청입니다.");
    const workflowId = pending.workflowId;
    const node = this.node(workflowId, pending.nodeId);
    this.recorder.appendRecorderEvent({ workflowId, nodeId: pending.nodeId, eventType: "DECISION_RESOLVED", actor: actor.id,
      action: node.actionType, approvalId, policyClass: node.policyClass, policyVersion: node.policy.policyVersion,
      externalEffect: "NONE", details: { decision, approvalVersion: result.approval.version } });
    if (decision === "REJECTED") {
      this.setNodeStatus(workflowId, pending.nodeId, "REJECTED");
      const rollback = await this.workspace.rollbackTemporaryArtifacts(workflowId);
      if (rollback.status === "ROLLED_BACK") {
        for (const preparedNode of this.getSnapshot(workflowId).nodes.filter(item => item.kind === "DOCUMENT_GENERATION" && item.status === "WAITING")) {
          this.setNodeStatus(workflowId, preparedNode.id, "REJECTED");
          this.setNodeStatus(workflowId, preparedNode.id, "ROLLED_BACK");
        }
        this.setNodeStatus(workflowId, pending.nodeId, "ROLLED_BACK");
        this.setWorkflowStatus(workflowId, "FAILED");
        this.db.prepare("UPDATE workflows SET error_code='DECISION_REJECTED',error_message=? WHERE id=?").run("요청이 거절되어 임시 결과를 폐기했습니다.", workflowId);
        this.recorder.appendRecorderEvent({ workflowId, nodeId: pending.nodeId, eventType: "ROLLBACK_COMPLETED", actor: "actflow-engine",
          rollbackStatus: "ROLLED_BACK", externalEffect: "NONE", details: { deleted: rollback.deleted, remainingFiles: [] } });
      }
      return this.getSnapshot(workflowId);
    }
    this.setWorkflowStatus(workflowId, "RUNNING");
    if (node.actionType !== "expense.process" && node.actionType !== "workflow.complete" && node.actionType !== "demo.email.simulate") {
      await this.runAutoNode(workflowId, node.task, approvalId);
      return this.runUntilGate(workflowId);
    }
    this.setNodeStatus(workflowId, pending.nodeId, "RUNNING");
    if (node.actionType === "demo.email.simulate") {
      try {
      const tool = getTool(node.actionType);
      if (tool.externalSideEffect) throw new WorkflowConflictError("실제 외부 연결은 이 빌드에서 지원하지 않습니다.");
      const toolResult = await executeTool(node.actionType, this.argsFor(node.task, this.workflow(workflowId)), { workflowId, nodeId: node.id });
      if (!toolResult.ok || toolResult.sent || toolResult.externalSideEffect) throw new Error("Simulation result contradicted the no-send contract");
      this.setNodeResult(workflowId, node.id, { toolResult });
      this.recorder.appendRecorderEvent({ workflowId, nodeId: node.id, eventType: "TOOL_EXECUTED", actor: "actflow-engine",
        action: node.actionType, policyClass: node.policyClass, approvalId, externalEffect: "NONE",
        details: { sent: toolResult.sent ?? false, simulation: true } });
      } catch (error) {
        this.failTask(workflowId, node.task, error);
        throw error;
      }
    }
    this.setNodeStatus(workflowId, pending.nodeId, "COMPLETED");
    return this.runUntilGate(workflowId);
  }
}
