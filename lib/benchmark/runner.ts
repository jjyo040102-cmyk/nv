import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import type { ProviderId, SessionActor, WorkflowAnalysis } from "../domain/types";
import { openDatabase } from "../db";
import { runMigrations } from "../db/migrate";
import { WorkflowRepository } from "../db/repository";
import { OFFICIAL_DEMO_TEXT } from "../providers/demo";
import { createProvider, createWorkflowAnalyzer } from "../providers/registry";
import { WorkflowEngine } from "../workflow/engine";
import { verifyArtifact } from "../workflow/verifier";
import { summarizeBenchmark, type BenchmarkReport, type BenchmarkRun } from "./report";

export type BenchmarkOptions = { runs?: number; provider?: ProviderId; model?: string; effort?: string; rootDir?: string; allowReal?: boolean; apiKey?: string };
const user: SessionActor = { id: "demo-user", sessionId: "actflow-local-demo", role: "USER" };
const approver: SessionActor = { ...user, id: "demo-approver", role: "APPROVER" };
const expectedActions = ["employee.lookup", "expense.process", "artifact.xlsx.participants", "artifact.docx.response", "demo.email.simulate", "workflow.complete"];
function extractedCorrectly(analysis: WorkflowAnalysis | null): boolean {
  const facts = Object.fromEntries((analysis?.facts ?? []).map(f => [f.key, f.value]));
  return !!analysis && expectedActions.every(action => analysis.tasks.some(t => t.actionType === action)) && analysis.tasks.length === 6 && facts.sender === "교육 운영팀" && facts.deadline === "2026-11-20" && facts.expenseKrw === "180000";
}
export async function runBenchmark(options: BenchmarkOptions = {}): Promise<BenchmarkReport> {
  const metadata = { runs: options.runs ?? 20, provider: options.provider ?? "demo", model: options.model ?? "actflow-demo-v1", effort: options.effort ?? "default" };
  if (!Number.isInteger(metadata.runs) || metadata.runs < 1 || metadata.runs > 1000) throw new Error("Run count must be 1–1000");
  if (metadata.provider !== "demo" && !options.allowReal) throw new Error("Real-provider benchmark requires explicit opt-in");
  if (metadata.provider !== "demo" && !options.apiKey) throw new Error("Real-provider benchmark requires a configured user API key");
  const provider = createProvider({ ...metadata, apiKey: options.apiKey });
  const analyzer = createWorkflowAnalyzer(provider);
  const base = options.rootDir ?? resolve("data/runtime/benchmark-workspaces", randomUUID());
  const raw: BenchmarkRun[] = [];
  for (let iteration = 0; iteration < metadata.runs; iteration++) {
    const modes: BenchmarkRun["mode"][] = iteration % 2 ? ["PRE_EXECUTION", "MANUAL"] : ["MANUAL", "PRE_EXECUTION"];
    for (const mode of modes) {
      const root = resolve(base, `${iteration}-${mode}`);
      const db = openDatabase({ dataDir: root, dbPath: resolve(root, "actflow.sqlite"), demoAuth: true, maxUploadMb: 25 });
      const run: BenchmarkRun = { iteration, mode, workflowId: "", analyzeLatencyMs: 0, approvalToResultMs: null, extractionPassed: false, toolAttempts: 0, toolSucceeded: 0,
        verificationPassed: false, rollbackPassed: false, completed: false, noExternalSideEffect: true, realModelCalled: false, artifacts: [], rollback: { deleted: [], remainingFiles: [] }, errors: [] };
      try {
        runMigrations(db); const repo = new WorkflowRepository(db); const engine = new WorkflowEngine(db, root);
        const workflow = repo.createWorkflow({ sourceName: "training-notice.txt", sourceText: OFFICIAL_DEMO_TEXT, executionMode: mode, preExecutionEnabled: mode === "PRE_EXECUTION" });
        run.workflowId = workflow.id;
        const start = performance.now();
        try { await engine.analyzeWorkflow(workflow.id, analyzer); } finally { run.analyzeLatencyMs = performance.now() - start; }
        run.extractionPassed = extractedCorrectly(engine.getSnapshot(workflow.id).workflow.analysis);
        run.realModelCalled = engine.getSnapshot(workflow.id).workflow.provider?.realModelCalled ?? false;
        const waiting = await engine.executeWorkflow(workflow.id, user);
        const approval = waiting.approvals.find(a => a.kind === "APPROVAL" && a.status === "PENDING");
        if (!approval) throw new Error("Expected expense approval was absent");
        const approvedAt = performance.now();
        const afterApproval = await engine.resolveApproval(approval.id, "APPROVED", approval.version, approver);
        if (afterApproval.artifacts.length !== 2 || !afterApproval.artifacts.every(a => a.verificationStatus === "VERIFIED" && a.state === "COMMITTED")) throw new Error("Expected verified XLSX and DOCX were absent");
        run.approvalToResultMs = performance.now() - approvedAt;
        for (const artifact of afterApproval.artifacts) {
          const path = resolve(root, artifact.relativePath), kind = artifact.displayName.endsWith(".xlsx") ? "xlsx" : "docx";
          const result = await verifyArtifact({ path, kind, requiredTexts: kind === "xlsx" ? ["이름", "부서"] : ["AI 교육 참석 회신", "교육 운영팀"] });
          run.artifacts.push({ id: artifact.id, path, sha256: result.sha256, byteSize: result.size, physicallyVerified: result.passed && result.sha256 === artifact.sha256 });
        }
        run.verificationPassed = run.artifacts.length === 2 && run.artifacts.every(a => a.physicallyVerified);
        const confirm = afterApproval.approvals.find(a => a.kind === "CONFIRM" && a.status === "PENDING");
        if (!confirm) throw new Error("Expected send confirmation was absent");
        const completed = await engine.resolveApproval(confirm.id, "APPROVED", confirm.version, user);
        run.completed = completed.workflow.status === "COMPLETED";
        run.noExternalSideEffect = completed.events.every(e => e.externalEffect === "NONE") && completed.nodes.filter(n => n.actionType === "demo.email.simulate").every(n => (n.result?.toolResult as { sent?: boolean })?.sent === false);
      } catch (error) { run.errors.push(error instanceof Error ? error.name : "BenchmarkRunError"); }
      finally {
        if (run.workflowId) {
          const events = new WorkflowEngine(db, root).getSnapshot(run.workflowId).events;
          run.toolSucceeded = events.filter(e => e.eventType === "PREPARED" || (e.eventType === "TOOL_EXECUTED" && !e.details?.reusedPrepared)).length;
          run.toolAttempts = run.toolSucceeded + events.filter(e => e.eventType === "TOOL_FAILED" || e.eventType === "PREPARATION_FAILED").length;
        }
      }
      try {
        const repo = new WorkflowRepository(db), engine = new WorkflowEngine(db, root);
        const workflow = repo.createWorkflow({ sourceName: "training-notice.txt", sourceText: OFFICIAL_DEMO_TEXT, executionMode: "PRE_EXECUTION", preExecutionEnabled: true });
        await engine.analyzeWorkflow(workflow.id, analyzer); const waiting = await engine.executeWorkflow(workflow.id, user);
        const before = waiting.artifacts.filter(a => a.state === "TEMPORARY").map(a => resolve(root, a.relativePath));
        const approval = waiting.approvals.find(a => a.kind === "APPROVAL" && a.status === "PENDING");
        if (!approval || before.length !== 2 || !before.every(existsSync)) throw new Error("Rollback preparation missing");
        const rejected = await engine.resolveApproval(approval.id, "REJECTED", approval.version, approver);
        run.rollback.deleted = rejected.artifacts.filter(a => a.state === "DELETED").map(a => resolve(root, a.relativePath));
        run.rollback.remainingFiles = before.filter(existsSync);
        run.rollbackPassed = run.rollback.deleted.length === 2 && run.rollback.remainingFiles.length === 0 && rejected.workflow.errorCode === "DECISION_REJECTED" && rejected.events.some(e => e.eventType === "ROLLBACK_COMPLETED");
        run.noExternalSideEffect &&= rejected.events.every(e => e.externalEffect === "NONE");
      } catch (error) { run.errors.push(error instanceof Error ? error.name : "RollbackBenchmarkError"); }
      finally { db.close(); }
      raw.push(run);
    }
  }
  return summarizeBenchmark(metadata, raw);
}
