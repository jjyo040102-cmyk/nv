import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import type Database from "better-sqlite3";
import type { ActionRisk, WorkflowAnalysis, WorkflowTask } from "../../lib/domain/types";
import { openDatabase } from "../../lib/db";
import { runMigrations } from "../../lib/db/migrate";
import { WorkflowRepository } from "../../lib/db/repository";
import { WorkflowEngine } from "../../lib/workflow/engine";
import { getTool } from "../../lib/tools/registry";

const roots: string[] = [];
const databases: Database.Database[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) { if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected cleanup target"); rmSync(root, { recursive: true, force: true }); }
});
const user = { id: "demo-user", sessionId: "actflow-local-demo", role: "USER" as const };
const approver = { id: "demo-approver", sessionId: "actflow-local-demo", role: "APPROVER" as const };
const zeroRisk: ActionRisk = { moneyMovement: 0, externalTransmission: 0, sensitiveData: 0, legalEffect: 0, organizationalAuthority: 0, userRepresentation: 0, destructiveMutation: 0, reversibility: 5 };
function task(id: string, actionType: string, kind: WorkflowTask["kind"], dependsOn: string[]): WorkflowTask {
  return { id, title: id, actionType, kind, dependsOn, condition: null, expectedOutput: null, risk: zeroRisk, suggestedPolicy: "AUTO" };
}
const fixtureAnalysis: WorkflowAnalysis = {
  summary: "AI 교육 참가자 명단 및 회신", facts: [
    { key: "deadline", value: "2026-10-20", confidence: 1, evidence: { source: "notice.txt" } },
    { key: "expenseKrw", value: "180000", confidence: 1, evidence: { source: "notice.txt" } },
    { key: "sender", value: "교육 운영팀", confidence: 1, evidence: { source: "notice.txt" } }
  ],
  tasks: [
    task("lookup", "employee.lookup", "DATA_LOOKUP", []),
    task("expense", "expense.process", "APPROVAL", ["lookup"]),
    task("xlsx", "artifact.xlsx.participants", "DOCUMENT_GENERATION", ["expense"]),
    task("docx", "artifact.docx.response", "DOCUMENT_GENERATION", ["expense"]),
    task("email", "demo.email.simulate", "EXTERNAL_ACTION", ["xlsx", "docx"]),
    task("done", "workflow.complete", "COMPLETION", ["email"])
  ],
  edges: [
    { from: "lookup", to: "expense", condition: "always" }, { from: "expense", to: "xlsx", condition: "approved" },
    { from: "expense", to: "docx", condition: "approved" }, { from: "xlsx", to: "email", condition: "always" },
    { from: "docx", to: "email", condition: "always" }, { from: "email", to: "done", condition: "confirmed" }
  ],
  warnings: [], provider: { provider: "demo", model: "actflow-demo-v1", mode: "demo", realModelCalled: false }
};
function setup(preExecutionEnabled = false, analysis = fixtureAnalysis) {
  const root = mkdtempSync(resolve(tmpdir(), "actflow-engine-"));
  roots.push(root);
  const db = openDatabase({ dataDir: root, dbPath: ":memory:", demoAuth: true, maxUploadMb: 25 });
  databases.push(db);
  runMigrations(db);
  const repository = new WorkflowRepository(db);
  const workflow = repository.createWorkflow({ sourceName: "notice.txt", sourceText: "AI 교육 참가자 명단을 2026-10-20까지 제출. 출장비 180000원.", preExecutionEnabled, executionMode: preExecutionEnabled ? "PRE_EXECUTION" : "MANUAL" });
  const engine = new WorkflowEngine(db, root);
  return { root, db, workflow, engine, analysis };
}

describe("workflow engine", () => {
  it("Analyze persists graph and facts but runs zero business tools", async () => {
    const { workflow, engine, analysis } = setup(true);
    const result = await engine.analyzeWorkflow(workflow.id, async () => analysis);
    expect(result).toMatchObject({ executedActions: 0, message: "아직 실행된 작업이 없습니다." });
    expect(result.snapshot.workflow.status).toBe("ANALYZED");
    expect(result.snapshot.nodes.find(node => node.id === "expense")?.policyClass).toBe("APPROVAL");
    expect(result.snapshot.nodes.find(node => node.id === "email")?.policyClass).toBe("CONFIRM");
    expect(result.snapshot.artifacts).toHaveLength(0);
    expect(result.snapshot.events.some(event => event.eventType === "TOOL_EXECUTED")).toBe(false);
  });
  it("manual Execute starts lookup and pauses before expense without speculative files", async () => {
    const { workflow, engine, analysis } = setup();
    await engine.analyzeWorkflow(workflow.id, async () => analysis);
    const snapshot = await engine.executeWorkflow(workflow.id, user);
    expect(snapshot.workflow.status).toBe("WAITING");
    expect(snapshot.nodes.find(node => node.id === "lookup")?.status).toBe("VERIFIED");
    expect(snapshot.approvals).toMatchObject([{ nodeId: "expense", kind: "APPROVAL", status: "PENDING" }]);
    expect(snapshot.artifacts).toHaveLength(0);
  });
  it("pre-execution prepares only local reversible artifacts while external actions stay untouched", async () => {
    const { workflow, engine, analysis } = setup(true);
    await engine.analyzeWorkflow(workflow.id, async () => analysis);
    const snapshot = await engine.executeWorkflow(workflow.id, user);
    expect(snapshot.artifacts.map(artifact => artifact.state)).toEqual(["TEMPORARY", "TEMPORARY"]);
    expect(snapshot.events.some(event => event.eventType === "TOOL_EXECUTED" && event.action === "demo.email.simulate")).toBe(false);
    expect(snapshot.workflow.status).toBe("WAITING");
  });
  it("requires approver, reuses prepared files, verifies actual artifacts, then confirms a truthful simulation once", async () => {
    const { root, workflow, engine, analysis } = setup(true);
    await engine.analyzeWorkflow(workflow.id, async () => analysis);
    const waiting = await engine.executeWorkflow(workflow.id, user);
    const expense = waiting.approvals[0];
    await expect(engine.resolveApproval(expense.id, "APPROVED", 0, user)).rejects.toThrow();
    const afterApproval = await engine.resolveApproval(expense.id, "APPROVED", 0, approver);
    expect(afterApproval.workflow.status).toBe("WAITING");
    expect(afterApproval.artifacts).toHaveLength(2);
    expect(afterApproval.artifacts.every(artifact => artifact.state === "COMMITTED" && artifact.verificationStatus === "VERIFIED")).toBe(true);
    expect(afterApproval.artifacts.every(artifact => existsSync(resolve(root, artifact.relativePath)))).toBe(true);
    expect(afterApproval.events.filter(event => event.eventType === "TOOL_EXECUTED" && event.action?.startsWith("artifact.")).every(event => event.details?.reusedPrepared === true)).toBe(true);
    await expect(engine.resolveApproval(expense.id, "REJECTED", 0, approver)).rejects.toThrow();
    const confirmation = afterApproval.approvals.find(item => item.nodeId === "email")!;
    const done = await engine.resolveApproval(confirmation.id, "APPROVED", 0, user);
    expect(done.workflow.status).toBe("COMPLETED");
    expect(done.events.some(event => event.action === "demo.email.simulate" && event.externalEffect === "NONE" && event.details?.sent === false)).toBe(true);
    expect(done.artifacts).toHaveLength(2);
  });
  it("reject physically removes prepared files and leaves no committed artifact", async () => {
    const { root, workflow, engine, analysis } = setup(true);
    await engine.analyzeWorkflow(workflow.id, async () => analysis);
    const waiting = await engine.executeWorkflow(workflow.id, user);
    const oldPaths = waiting.artifacts.map(artifact => resolve(root, artifact.relativePath));
    const rejected = await engine.resolveApproval(waiting.approvals[0].id, "REJECTED", 0, approver);
    expect(rejected.workflow.status).toBe("FAILED");
    expect(rejected.artifacts.every(artifact => artifact.state === "DELETED")).toBe(true);
    expect(rejected.nodes.filter(node => node.kind === "DOCUMENT_GENERATION").every(node => node.status === "ROLLED_BACK")).toBe(true);
    expect(oldPaths.every(path => !existsSync(path))).toBe(true);
    expect(rejected.events.some(event => event.eventType === "ROLLBACK_COMPLETED")).toBe(true);
  });
  it("never runs a HUMAN_ONLY action", async () => {
    const analysis: WorkflowAnalysis = { ...fixtureAnalysis, tasks: [task("contract", "contract.sign", "HUMAN_ONLY", [])], edges: [] };
    const { workflow, engine } = setup(false, analysis);
    await engine.analyzeWorkflow(workflow.id, async () => analysis);
    const snapshot = await engine.executeWorkflow(workflow.id, user);
    expect(snapshot.nodes[0]).toMatchObject({ status: "BLOCKED", policyClass: "HUMAN_ONLY" });
    expect(snapshot.events.some(event => event.eventType === "TOOL_EXECUTED")).toBe(false);
  });
  it("rejects a tampered prepared roster before commit and physically rolls back temporary files", async () => {
    const { root, workflow, engine, analysis } = setup(true);
    await engine.analyzeWorkflow(workflow.id, async () => analysis);
    const waiting = await engine.executeWorkflow(workflow.id, user);
    const roster = waiting.artifacts.find(artifact => artifact.displayName.endsWith("xlsx"))!;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("메모");
    sheet.addRow(["메모", "잘못된 값"]);
    sheet.addRow(["김민지 이준호", "대상자 행이 없습니다."]);
    writeFileSync(resolve(root, roster.relativePath), Buffer.from(await workbook.xlsx.writeBuffer()));
    await expect(engine.resolveApproval(waiting.approvals[0].id, "APPROVED", 0, approver)).rejects.toThrow();
    const failed = engine.getSnapshot(workflow.id);
    expect(failed.workflow.status).toBe("FAILED");
    expect(failed.artifacts.every(artifact => artifact.state === "DELETED")).toBe(true);
    expect(waiting.artifacts.every(artifact => !existsSync(resolve(root, artifact.relativePath)))).toBe(true);
    expect(failed.events.some(event => event.eventType === "ROLLBACK_COMPLETED")).toBe(true);
    expect(failed.events.some(event => event.action === "demo.email.simulate" && event.eventType === "TOOL_EXECUTED")).toBe(false);
  });
  it("does not commit a semantically wrong generator output or claim a failed rollback succeeded", async () => {
    const { root, db, workflow, analysis } = setup();
    const engine = new WorkflowEngine(db, root, { unlink: async () => { throw new Error("Synthetic deletion failure"); } });
    vi.spyOn(getTool("artifact.xlsx.participants"), "execute").mockImplementationOnce(async (_args, ctx) => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("메모");
      sheet.addRow(["메모", "김민지 이준호"]);
      const artifact = await ctx.workspace!.writeTemporaryArtifact({ workflowId: ctx.workflowId, createdByNode: ctx.nodeId,
        displayName: "잘못된_명단.xlsx", bytes: Buffer.from(await workbook.xlsx.writeBuffer()), preparationKey: ctx.preparationKey });
      return { ok: true, artifactId: artifact.id, filesCreated: [artifact.relativePath], dataRead: [], fieldsRead: [], fieldsExcluded: [],
        externalSideEffect: false, reversible: true, evidence: { state: "TEMPORARY" } };
    });
    await engine.analyzeWorkflow(workflow.id, async () => analysis);
    const waiting = await engine.executeWorkflow(workflow.id, user);
    await expect(engine.resolveApproval(waiting.approvals[0].id, "APPROVED", 0, approver)).rejects.toThrow();
    const failed = engine.getSnapshot(workflow.id);
    expect(failed.workflow.errorCode).toBe("ROLLBACK_FAILED");
    expect(failed.artifacts).toMatchObject([{ state: "DELETE_FAILED", verificationStatus: "FAILED" }]);
    expect(existsSync(resolve(root, failed.artifacts[0].relativePath))).toBe(true);
    expect(failed.events.some(event => event.eventType === "ROLLBACK_COMPLETED")).toBe(false);
    expect(failed.events.some(event => event.eventType === "ARTIFACT_COMMITTED")).toBe(false);
    const verification = failed.events.find(event => event.eventType === "VERIFICATION" && event.action === "artifact.xlsx.participants");
    expect(verification?.details?.goalSatisfied).toBe(false);
  });
});
