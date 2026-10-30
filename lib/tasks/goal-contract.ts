import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { SessionActor, WorkflowAnalysis } from "../domain/types";
import { TaskConflictError, withTaskLease } from "./lease";
import { readVerifiedArtifact } from "../security/verified-artifact";
import { recordActivity } from "../audit/activity";
import { LivingTaskRepository } from "./repository";

type Requirement = { id: string; requirement_key: string; kind: "STEP" | "ARTIFACT" | "FACT" | "MAIL" | "OWNER"; label: string; spec_json: string; owner_confirmed_at: string | null };
export type GoalRequirementView = { id: string; label: string; kind: Requirement["kind"]; passed: boolean; evidence: string; canConfirm: boolean };
export type GoalContractView = { version: number; goalHash: string; requirements: GoalRequirementView[]; readyToComplete: boolean; confirmed: boolean };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const normalizeText = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim();

/** Verifies source support, not the truth of a claim in an external document. */
export function factHasSource(value: string, quote: string | undefined, source: string, key: string): boolean {
  if (!quote?.trim()) return false;
  const normalizedQuote = normalizeText(quote), normalizedSource = normalizeText(source);
  if (!normalizedSource.includes(normalizedQuote)) return false;
  if (key === "expenseKrw") {
    const numbers = normalizedQuote.match(/\d[\d,]*/g) ?? [];
    return numbers.some(number => number.replaceAll(",", "") === value.replaceAll(",", ""));
  }
  return normalizedQuote.includes(normalizeText(value));
}

export class GoalContracts {
  constructor(private readonly db: Database.Database) {}
  create(taskId: string, owner: string, goal: string): void {
    const now = new Date().toISOString();
    this.db.prepare("INSERT OR IGNORE INTO goal_contracts(living_task_id,owner_session_id,goal_hash,created_at,updated_at) VALUES (?,?,?,?,?)").run(taskId, owner, hash(goal), now, now);
    this.add(taskId, "owner-goal", "OWNER", "결과가 처음 맡긴 목표를 충족하는지 확인", { goal });
  }
  private add(taskId: string, key: string, kind: Requirement["kind"], label: string, spec: Record<string, unknown>): boolean {
    return this.db.prepare("INSERT OR IGNORE INTO goal_requirements(id,living_task_id,requirement_key,kind,label,spec_json,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(randomUUID(), taskId, key, kind, label, JSON.stringify(spec), new Date().toISOString()).changes === 1;
  }
  private registerAction(taskId: string, action: string, kind: Requirement["kind"], label: string, workflowId?: string): boolean {
    const spec = { action, ...(workflowId ? { workflowId } : {}) };
    const previous = this.db.prepare("SELECT id,label,spec_json FROM goal_requirements WHERE living_task_id=? AND requirement_key=?")
      .get(taskId, action) as { id: string; label: string; spec_json: string } | undefined;
    if (!previous) return this.add(taskId, action, kind, label, spec);
    if (previous.label === label && previous.spec_json === JSON.stringify(spec)) return false;
    this.db.prepare("UPDATE goal_requirements SET label=?,spec_json=?,owner_confirmed_at=NULL WHERE id=?")
      .run(label, JSON.stringify(spec), previous.id);
    return true;
  }
  registerPlan(taskId: string, owner: string, analysis: WorkflowAnalysis, source: string, workflowId?: string): void {
    if (!this.exists(taskId, owner)) return;
    if (workflowId && !this.db.prepare("SELECT 1 FROM workflows WHERE id=? AND living_task_id=? AND owner_session_id=?").get(workflowId, taskId, owner)) {
      throw new TaskConflictError("완료 조건에 연결할 실행의 소유 범위가 일치하지 않습니다.");
    }
    this.db.transaction(() => {
      let changed = false;
      const actions = new Map<string, string[]>();
      for (const task of analysis.tasks.filter(item => item.actionType !== "workflow.complete")) {
        const labels = actions.get(task.actionType) ?? [];
        labels.push(task.expectedOutput || task.title);
        actions.set(task.actionType, labels);
      }
      for (const [action, labels] of actions) {
        const kind = action.startsWith("artifact.") ? "ARTIFACT" : action === "external.email.send" ? "MAIL" : "STEP";
        changed = this.registerAction(taskId, action, kind, [...new Set(labels)].join(" · "), workflowId) || changed;
      }
      if (analysis.emailReply) changed = this.registerAction(taskId, "external.email.send", "MAIL", "승인한 답장의 실제 발송 확인", workflowId) || changed;
      for (const fact of analysis.facts.filter(item => ["sender", "deadline", "expenseKrw"].includes(item.key))) {
        const grounded = factHasSource(fact.value, fact.evidence?.quoteOrLocator, source, fact.key);
        const key = `fact:${fact.key}`, label = `${fact.key === "expenseKrw" ? "비용" : fact.key === "deadline" ? "기한" : "회신 대상"}: ${fact.value}`;
        const spec = { value: fact.value, key: fact.key, sourceHash: hash(source), quote: fact.evidence?.quoteOrLocator ?? null, grounded };
        const previous = this.db.prepare("SELECT id,spec_json FROM goal_requirements WHERE living_task_id=? AND requirement_key=?").get(taskId,key) as {id:string;spec_json:string}|undefined;
        if (previous && previous.spec_json !== JSON.stringify(spec)) {
          this.db.prepare("UPDATE goal_requirements SET label=?,spec_json=?,owner_confirmed_at=NULL WHERE id=?").run(label,JSON.stringify(spec),previous.id);
          recordActivity(this.db,owner,taskId,"GOAL_FACT_REVISED",{key,previous:previous.spec_json,next:JSON.stringify(spec)});
          changed = true;
        } else if (!previous) changed = this.add(taskId,key,"FACT",label,spec) || changed;
      }
      if (changed) {
        this.db.prepare("UPDATE goal_contracts SET version=version+1,confirmed_version=NULL,updated_at=? WHERE living_task_id=?").run(new Date().toISOString(), taskId);
        this.db.prepare("UPDATE goal_requirements SET owner_confirmed_at=NULL WHERE living_task_id=? AND kind='OWNER'").run(taskId);
      }
    })();
  }
  exists(taskId: string, owner: string): boolean { return Boolean(this.db.prepare("SELECT 1 FROM goal_contracts WHERE living_task_id=? AND owner_session_id=?").get(taskId, owner)); }
  view(taskId: string, owner: string): GoalContractView | null {
    const contract = this.db.prepare("SELECT * FROM goal_contracts WHERE living_task_id=? AND owner_session_id=?").get(taskId, owner) as { goal_hash: string; version: number; confirmed_version: number | null } | undefined;
    if (!contract) return null;
    const rows = this.db.prepare("SELECT * FROM goal_requirements WHERE living_task_id=? ORDER BY CASE WHEN kind='OWNER' THEN 1 ELSE 0 END,created_at,rowid").all(taskId) as Requirement[];
    const requirements = rows.map(row => {
      const spec = JSON.parse(row.spec_json) as { action?: string; workflowId?: string; grounded?: boolean };
      let passed = false, evidence = "아직 확인되지 않았습니다.", canConfirm = false;
      if (row.kind === "OWNER") { passed = Boolean(row.owner_confirmed_at); canConfirm = true; evidence = passed ? "사용자가 결과를 확인했습니다." : "완료 전에 결과를 확인하세요."; }
      else if (row.kind === "FACT") { passed = spec.grounded === true || Boolean(row.owner_confirmed_at); canConfirm = !spec.grounded; evidence = spec.grounded ? "원문의 인용 구절과 값이 일치합니다." : passed ? "사용자가 원문을 확인했습니다." : "원문 근거를 자동 확인하지 못했습니다."; }
      else if (row.kind === "MAIL") {
        // A prior send cannot satisfy a new proposal before its durable handoff.
        const sent = this.db.prepare(`SELECT status,result_json FROM mail_outbox WHERE living_task_id=? AND owner_session_id=?
          AND (? IS NULL OR workflow_id=? OR workflow_id=(SELECT reply_workflow_id FROM task_episode_context WHERE workflow_id=? AND living_task_id=? AND owner_session_id=?))
          ORDER BY rowid DESC LIMIT 1`).get(taskId, owner, spec.workflowId ?? null, spec.workflowId ?? null, spec.workflowId ?? null, taskId, owner) as { status: string; result_json: string | null } | undefined;
        let receipt: Record<string, unknown> = {};
        try { const value: unknown = JSON.parse(sent?.result_json ?? "{}"); if (value && typeof value === "object") receipt = value as Record<string, unknown>; } catch { /* A corrupt checkpoint is not verified delivery. */ }
        passed = sent?.status === "SENT" && receipt.ok === true && receipt.sent === true && receipt.externalEffect === "ACTUAL" && receipt.remoteVerified === true
          && typeof receipt.messageId === "string" && receipt.messageId.length > 0 && receipt.messageId.length <= 500 && !/[\r\n\0]/.test(receipt.messageId);
        evidence = passed ? "Gmail 보낸편지함에서 내용과 첨부파일을 확인했습니다." : receipt.externalEffect === "SIMULATED" ? "모의 발송입니다. 실제 발송 조건을 충족하지 않습니다." : "실제 발송 결과를 기다립니다.";
      } else {
        // Legacy requirements resolve the latest planned occurrence, never the latest successful one.
        const workflowId = spec.workflowId ?? (this.db.prepare(`SELECT w.id FROM workflows w WHERE w.living_task_id=? AND w.owner_session_id=?
          AND EXISTS (SELECT 1 FROM workflow_nodes n WHERE n.workflow_id=w.id AND n.action_type=?) ORDER BY w.created_at DESC,w.rowid DESC LIMIT 1`)
          .get(taskId, owner, spec.action) as { id: string } | undefined)?.id;
        const nodes = this.db.prepare(`SELECT n.id,n.workflow_id,n.status,w.status AS workflow_status FROM workflow_nodes n JOIN workflows w ON w.id=n.workflow_id
          WHERE w.living_task_id=? AND w.owner_session_id=? AND w.id=? AND n.action_type=?`).all(taskId, owner, workflowId ?? null, spec.action) as Array<{ id: string; workflow_id: string; status: string; workflow_status: string }>;
        passed = nodes.length > 0 && nodes.every(node => node.workflow_status !== "FAILED" && ["VERIFIED", "COMPLETED"].includes(node.status));
        if (row.kind === "ARTIFACT" && passed) passed = nodes.every(node => {
          const artifacts = this.db.prepare(`SELECT a.state,a.verification_status,EXISTS(SELECT 1 FROM verifications v
            WHERE v.artifact_id=a.id AND v.workflow_id=a.workflow_id AND v.node_id=a.node_id AND v.passed=1) AS verified
            FROM artifacts a WHERE a.workflow_id=? AND a.node_id=?`).all(node.workflow_id, node.id) as Array<{ state: string; verification_status: string; verified: number }>;
          return artifacts.length > 0 && artifacts.every(artifact => artifact.state === "COMMITTED" && artifact.verification_status === "VERIFIED" && artifact.verified === 1);
        });
        evidence = passed ? row.kind === "ARTIFACT" ? "파일의 구조·값 검사와 저장을 확인했습니다." : spec.action === "demo.email.simulate" ? "모의 실행 확인 · 실제 발송 없음" : spec.action === "expense.process" ? "비용 검토 승인 · 실제 결제 없음" : "등록된 작업의 실행 근거를 확인했습니다." : evidence;
      }
      return { id: row.id, kind: row.kind, label: row.label, passed, evidence, canConfirm };
    });
    const pending = Boolean(this.db.prepare(`SELECT 1 FROM approvals a JOIN workflows w ON w.id=a.workflow_id WHERE w.living_task_id=? AND a.status='PENDING' LIMIT 1`).get(taskId));
    const unknown = Boolean(this.db.prepare("SELECT 1 FROM mail_outbox WHERE living_task_id=? AND status IN ('SENDING','UNKNOWN','READY') LIMIT 1").get(taskId));
    const files = Boolean(this.db.prepare("SELECT 1 FROM artifacts a JOIN workflows w ON w.id=a.workflow_id WHERE w.living_task_id=? AND a.state IN ('TEMPORARY','DELETE_FAILED') LIMIT 1").get(taskId));
    const task = new LivingTaskRepository(this.db).get(taskId,owner);
    const settled = Boolean(task && ['WAITING_EVENT','READY','COMPLETED'].includes(task.status) && task.currentWorkflowId && this.db.prepare("SELECT 1 FROM workflows WHERE id=? AND status='COMPLETED'").get(task.currentWorkflowId));
    return { version: contract.version, goalHash: contract.goal_hash, requirements, readyToComplete: settled && !pending && !unknown && !files && requirements.every(row => row.passed || row.canConfirm), confirmed: contract.confirmed_version === contract.version };
  }
  complete(taskId: string, actor: SessionActor, version: number, confirmedIds: string[], dataDir: string) {
    return withTaskLease(this.db, taskId, actor.sessionId, async () => {
      const tasks = new LivingTaskRepository(this.db), task = tasks.get(taskId, actor.sessionId), view = this.view(taskId, actor.sessionId);
      if (!task || !view || view.version !== version || !view.readyToComplete || !task.currentWorkflowId || ["RUNNING", "PAUSED", "CANCELLED", "BLOCKED", "WAITING_APPROVAL", "FAILED"].includes(task.status)) throw new TaskConflictError("남은 조건과 현재 작업 상태를 먼저 확인하세요.");
      const workflow = this.db.prepare("SELECT status FROM workflows WHERE id=?").get(task.currentWorkflowId) as { status: string };
      if (workflow.status !== "COMPLETED") throw new TaskConflictError("실행이 끝나기 전에 목표를 완료할 수 없습니다.");
      const required = view.requirements.filter(row => !row.passed && row.canConfirm);
      if (required.some(row => !confirmedIds.includes(row.id))) throw new TaskConflictError("확인이 필요한 완료 조건을 모두 검토하세요.");
      const artifacts = this.db.prepare("SELECT a.id FROM artifacts a JOIN workflows w ON w.id=a.workflow_id WHERE w.living_task_id=? AND a.state='COMMITTED'").all(taskId) as Array<{ id: string }>;
      for (const artifact of artifacts) await readVerifiedArtifact(this.db, dataDir, { artifactId: artifact.id, ownerSessionId: actor.sessionId, livingTaskId: taskId });
      return this.db.transaction(() => {
        const fresh = tasks.get(taskId, actor.sessionId)!;
        const freshView = this.view(taskId,actor.sessionId);
        if (fresh.version !== task.version || freshView?.version !== version || !freshView.readyToComplete || hash(fresh.goal) !== view.goalHash) throw new TaskConflictError("작업이 변경됐습니다. 최신 결과를 확인하세요.");
        const now = new Date().toISOString();
        for (const row of required) this.db.prepare("UPDATE goal_requirements SET owner_confirmed_at=? WHERE id=? AND living_task_id=?").run(now, row.id, taskId);
        this.db.prepare("UPDATE goal_contracts SET confirmed_version=version,updated_at=? WHERE living_task_id=? AND version=?").run(now, taskId, version);
        this.db.prepare("UPDATE trigger_subscriptions SET enabled=0,updated_at=? WHERE living_task_id=?").run(now, taskId);
        const updated = tasks.update(taskId, actor.sessionId, task.version, { status: "COMPLETED", completedAt: now, waitingReason: null, backgroundWatchEnabled: false });
        recordActivity(this.db, actor.sessionId, taskId, "GOAL_COMPLETED_WITH_EVIDENCE", { version, requirements: view.requirements.length, ownerConfirmed: required.length });
        return updated;
      })();
    });
  }
}
