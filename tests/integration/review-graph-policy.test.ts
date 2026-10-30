import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { openDatabase } from "../../lib/db";
import { runMigrations } from "../../lib/db/migrate";
import { WorkflowRepository } from "../../lib/db/repository";
import { WorkflowEngine } from "../../lib/workflow/engine";
import { DemoProvider, OFFICIAL_DEMO_TEXT } from "../../lib/providers/demo";
import { AnalysisResultSchema } from "../../lib/providers/schemas";
import { buildWorkflowGraph } from "../../lib/workflow/builder";
import { builtInPolicySet } from "../../lib/policy/defaultPolicies";

const roots: string[] = [], databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => {
  databases.splice(0).forEach(db => db.close());
  roots.splice(0).forEach(root => {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  });
});
const user = { id: "demo-user", sessionId: "actflow-local-demo", role: "USER" as const };
const approver = { ...user, id: "demo-approver", role: "APPROVER" as const };
const original = await new DemoProvider().analyzeDocument({ text: OFFICIAL_DEMO_TEXT, sourceName: "notice.txt" });
function analysis() { return structuredClone(original); }
function setup() {
  const root = mkdtempSync(resolve(tmpdir(), "actflow-review-graph-")); roots.push(root);
  const db = openDatabase({ dataDir: root, dbPath: ":memory:", demoAuth: true, maxUploadMb: 25 }); databases.push(db); runMigrations(db);
  const repo = new WorkflowRepository(db);
  const workflow = repo.createWorkflow({ sourceName: "notice.txt", sourceText: OFFICIAL_DEMO_TEXT });
  return { db, workflow, engine: new WorkflowEngine(db, root) };
}

describe("review regressions: authoritative graph and expense facts", () => {
  it.each(["rejected", "declined"] as const)("rejects unsupported %s branches before any execution", async condition => {
    const { engine, workflow } = setup(), value = analysis();
    value.edges.find(edge => edge.to === "xlsx")!.condition = condition;
    await expect(engine.analyzeWorkflow(workflow.id, async () => value)).rejects.toThrow();
    expect(engine.getSnapshot(workflow.id).nodes).toHaveLength(0);
    expect(engine.getSnapshot(workflow.id).artifacts).toHaveLength(0);
  });
  it("rejects free-text task conditions rather than silently ignoring them", () => {
    const value = analysis(); value.tasks[2].condition = "if rejected, send the document";
    expect(() => AnalysisResultSchema.parse(value)).toThrow();
  });
  it("normalizes an edge-only approval gate into the actual execution dependencies", async () => {
    const { engine, workflow } = setup(), value = analysis();
    value.tasks.find(task => task.id === "xlsx")!.dependsOn = [];
    value.tasks = [value.tasks[2], value.tasks[0], value.tasks[1], ...value.tasks.slice(3)];
    const analyzed = await engine.analyzeWorkflow(workflow.id, async () => value);
    expect(analyzed.snapshot.nodes.find(node => node.id === "xlsx")!.task.dependsOn).toContain("expense");
    const waiting = await engine.executeWorkflow(workflow.id, user);
    expect(waiting.artifacts).toHaveLength(0);
    expect(waiting.approvals[0].nodeId).toBe("expense");
  });
  it("adds dependency-only connections to the displayed authoritative graph", () => {
    const value = analysis(); value.edges = [];
    const normalized = AnalysisResultSchema.parse(value);
    expect(normalized.edges).toContainEqual({ from: "expense", to: "xlsx", condition: "always" });
    expect(normalized.edges).toHaveLength(6);
  });
  it("rejects cycles introduced only through graph edges", () => {
    const value = analysis(); value.edges.push({ from: "done", to: "lookup", condition: "always" });
    expect(() => AnalysisResultSchema.parse(value)).toThrow();
  });
  it("rejects a positive decision condition whose source has no matching decision gate", () => {
    const value = analysis(); value.edges.find(edge => edge.from === "lookup")!.condition = "approved";
    expect(() => buildWorkflowGraph(value, builtInPolicySet(1))).toThrow();
  });
  it("uses action semantics when a known artifact is mislabeled as COMPLETION", async () => {
    const { engine, workflow } = setup(), value = analysis();
    value.tasks.find(task => task.id === "xlsx")!.kind = "COMPLETION";
    await engine.analyzeWorkflow(workflow.id, async () => value);
    const waiting = await engine.executeWorkflow(workflow.id, user);
    const next = await engine.resolveApproval(waiting.approvals[0].id, "APPROVED", 0, approver);
    expect(next.artifacts).toHaveLength(2);
    expect(next.nodes.find(node => node.id === "xlsx")).toMatchObject({ kind: "DOCUMENT_GENERATION", status: "VERIFIED" });
  });
  it("normalizes a comma-separated expense once for policy and execution", async () => {
    const { engine, workflow } = setup(), value = analysis();
    value.facts.find(fact => fact.key === "expenseKrw")!.value = "180,000";
    const result = await engine.analyzeWorkflow(workflow.id, async () => value);
    expect(result.snapshot.workflow.analysis!.facts.find(fact => fact.key === "expenseKrw")!.value).toBe("180000");
    expect(result.snapshot.nodes.find(node => node.id === "expense")!.policyClass).toBe("APPROVAL");
    expect((await engine.executeWorkflow(workflow.id, user)).approvals[0].nodeId).toBe("expense");
  });
  it.each(["not known", "-1", "Infinity", "1e5", "9007199254740992"])("blocks invalid expense amount %s", amount => {
    const value = analysis(); value.facts.find(fact => fact.key === "expenseKrw")!.value = amount;
    expect(() => AnalysisResultSchema.parse(value)).toThrow();
    expect(() => buildWorkflowGraph(value, builtInPolicySet(1))).toThrow();
  });
  it("blocks missing expense amounts instead of treating them as zero", () => {
    const value = analysis(); value.facts = value.facts.filter(fact => fact.key !== "expenseKrw");
    expect(() => AnalysisResultSchema.parse(value)).toThrow();
  });
  it("rejects duplicate fact keys before policy and document values can diverge", () => {
    const value = analysis(); value.facts.push({ key: "expenseKrw", value: "1", confidence: 1 });
    expect(() => AnalysisResultSchema.parse(value)).toThrow();
    expect(() => buildWorkflowGraph(value, builtInPolicySet(1))).toThrow();
  });
});
