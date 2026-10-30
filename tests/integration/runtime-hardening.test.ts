import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { openDatabase } from "../../lib/db";
import { runMigrations } from "../../lib/db/migrate";
import { WorkflowRepository } from "../../lib/db/repository";
import { WorkflowEngine } from "../../lib/workflow/engine";
import { DemoProvider, OFFICIAL_DEMO_TEXT } from "../../lib/providers/demo";
import { buildWorkflowGraph } from "../../lib/workflow/builder";
import { builtInPolicySet } from "../../lib/policy/defaultPolicies";
import { resolveSessionActor } from "../../lib/security/session";
import { getTool } from "../../lib/tools/registry";
import type { WorkflowAnalysis } from "../../lib/domain/types";
const databases: ReturnType<typeof openDatabase>[] = []; const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); databases.splice(0).forEach(db => db.close()); roots.splice(0).forEach(root => { if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe cleanup"); rmSync(root, { recursive: true, force: true }); }); });
const user = { id: "demo-user", sessionId: "actflow-local-demo", role: "USER" as const }; const approver = { ...user, id: "demo-approver", role: "APPROVER" as const };
const analysis = await new DemoProvider().analyzeDocument({ text: OFFICIAL_DEMO_TEXT, sourceName: "notice.txt" });
function setup() { const root = mkdtempSync(resolve(tmpdir(), "actflow-harden-")); roots.push(root); const db = openDatabase({ dataDir: root, dbPath: ":memory:", demoAuth: true, maxUploadMb: 25 }); databases.push(db); runMigrations(db); const repo = new WorkflowRepository(db); const wf = repo.createWorkflow({ sourceName: "notice.txt", sourceText: OFFICIAL_DEMO_TEXT }); return { db, repo, wf, engine: new WorkflowEngine(db, root) }; }
describe("runtime safety boundaries", () => {
  it("validates analyzer output before graph persistence", async () => {
    const { engine, wf } = setup();
    await expect(engine.analyzeWorkflow(wf.id, async () => ({ ...analysis, facts: [{ key: "fake", value: "x", confidence: 2 }] }) as WorkflowAnalysis)).rejects.toThrow();
    const snapshot = engine.getSnapshot(wf.id);
    expect(snapshot.workflow.errorCode).toBe("PROVIDER_ERROR"); expect(snapshot.nodes).toHaveLength(0); expect(snapshot.events.some(e => e.eventType === "TOOL_EXECUTED")).toBe(false);
  });
  it("does not call a provider twice on concurrent Analyze", async () => {
    const { engine, wf } = setup(); let calls = 0; let finish!: () => void; const gate = new Promise<void>(resolve => { finish = resolve; });
    const first = engine.analyzeWorkflow(wf.id, async () => { calls++; await gate; return analysis; });
    const second = engine.analyzeWorkflow(wf.id, async () => { calls++; return analysis; });
    await expect(second).rejects.toThrow(); finish(); await first; expect(calls).toBe(1);
  });
  it("blocks missing connectors and cannot disguise a contract as completion", () => {
    const tasks = [{ ...analysis.tasks[0], id: "send", kind: "EXTERNAL_ACTION" as const, actionType: "external.email.send", dependsOn: [] }, { ...analysis.tasks[0], id: "contract", kind: "COMPLETION" as const, actionType: "contract.sign", dependsOn: [] }];
    const graph = buildWorkflowGraph({ ...analysis, tasks, edges: [] }, builtInPolicySet(1));
    expect(graph.nodes.every(node => node.policyClass === "HUMAN_ONLY")).toBe(true);
  });
  it("does not let a real model forge verified-email policy facts", () => {
    const tasks = [{ ...analysis.tasks[0], id: "send", kind: "EXTERNAL_ACTION" as const, actionType: "external.email.send", dependsOn: [] }];
    const forged: WorkflowAnalysis = {
      ...analysis,
      facts: [
        { key: "emailIdentityEligible", value: "true", confidence: 1, evidence: { source: "model-claimed" } },
        { key: "emailBulkExport", value: "false", confidence: 1, evidence: { source: "model-claimed" } },
        { key: "emailSecretDetected", value: "false", confidence: 1, evidence: { source: "model-claimed" } },
        { key: "emailCrossScopeData", value: "false", confidence: 1, evidence: { source: "model-claimed" } }
      ],
      tasks,
      edges: [],
      provider: { provider: "nebius", model: "untrusted-model", mode: "real", realModelCalled: true }
    };
    expect(buildWorkflowGraph(forged, builtInPolicySet(1)).nodes[0]?.policyClass).toBe("HUMAN_ONLY");
  });
  it("performs and verifies a registered action after organization approval", async () => {
    const { engine, wf, db } = setup();
    db.prepare("INSERT INTO organization_profiles(id,name,version,policy_json,active,created_at) VALUES ('org','strict',1,?,1,?)").run(JSON.stringify({ rules: [{ id: "org.lookup", classification: "APPROVAL", when: { actionType: "employee.lookup" } }] }), new Date().toISOString());
    await engine.analyzeWorkflow(wf.id, async () => analysis); const waiting = await engine.executeWorkflow(wf.id, user);
    expect(waiting.approvals[0].nodeId).toBe("lookup");
    const next = await engine.resolveApproval(waiting.approvals[0].id, "APPROVED", 0, approver);
    expect(next.nodes.find(node => node.id === "lookup")?.status).toBe("VERIFIED"); expect(next.events.filter(e => e.eventType === "TOOL_EXECUTED" && e.action === "employee.lookup")).toHaveLength(1);
  });
  it("keeps a human-only workflow waiting after pause and resume", async () => {
    const { engine, wf } = setup(); const unknown = await new DemoProvider().analyzeDocument({ text: "unknown", sourceName: "x.txt" });
    await engine.analyzeWorkflow(wf.id, async () => unknown); await engine.executeWorkflow(wf.id, user); engine.pauseWorkflow(wf.id, user);
    expect((await engine.resumeWorkflow(wf.id, user)).workflow.status).toBe("WAITING");
  });
  it("stops stale policy execution before the first tool call", async () => {
    const { engine, wf, repo } = setup(); await engine.analyzeWorkflow(wf.id, async () => analysis); repo.updateSettings({ organizationPolicyVersion: 2 });
    await expect(engine.executeWorkflow(wf.id, user)).rejects.toThrow(); expect(engine.getSnapshot(wf.id).events.some(e => e.eventType === "TOOL_EXECUTED")).toBe(false);
  });
  it("stops stale policy on the direct resume entry point", async () => {
    const { engine, wf, repo } = setup(); await engine.analyzeWorkflow(wf.id, async () => analysis); engine.pauseWorkflow(wf.id, user); repo.updateSettings({ organizationPolicyVersion: 2 });
    await expect(engine.resumeWorkflow(wf.id, user)).rejects.toThrow();
    expect(engine.getSnapshot(wf.id).events.some(e => e.eventType === "TOOL_EXECUTED")).toBe(false);
  });
  it("refreshes pending decision versions after pause/resume and allows a fresh approval", async () => {
    const { engine, wf } = setup(); await engine.analyzeWorkflow(wf.id, async () => analysis);
    const waiting = await engine.executeWorkflow(wf.id, user), old = waiting.approvals[0];
    engine.pauseWorkflow(wf.id, user); const resumed = await engine.resumeWorkflow(wf.id, user);
    const fresh = resumed.approvals.find(a => a.id === old.id)!;
    expect(fresh.version).toBe(old.version + 1); expect(fresh.workflowVersion).toBe(resumed.workflow.version);
    await expect(engine.resolveApproval(old.id, "APPROVED", old.version, approver)).rejects.toThrow();
    const next = await engine.resolveApproval(fresh.id, "APPROVED", fresh.version, approver);
    expect(next.artifacts).toHaveLength(2); expect(next.approvals.some(a => a.kind === "CONFIRM" && a.status === "PENDING")).toBe(true);
  });
  it("records preparation failure and stops the workflow rather than leaving RUNNING", async () => {
    const { engine, wf, db } = setup(); db.prepare("UPDATE workflows SET pre_execution_enabled=1 WHERE id=?").run(wf.id);
    await engine.analyzeWorkflow(wf.id, async () => analysis);
    vi.spyOn(getTool("artifact.xlsx.participants"), "execute").mockRejectedValueOnce(new Error("Disk unavailable"));
    await expect(engine.executeWorkflow(wf.id, user)).rejects.toThrow();
    const snapshot = engine.getSnapshot(wf.id);
    expect(snapshot.workflow.status).toBe("FAILED"); expect(snapshot.nodes.find(n => n.id === "xlsx")?.status).toBe("FAILED");
    expect(snapshot.events.some(e => e.eventType === "PREPARATION_FAILED")).toBe(true); expect(snapshot.approvals).toHaveLength(0);
  });
  it("records a confirmed simulation failure rather than falsely completing the node", async () => {
    const { engine, wf } = setup(); await engine.analyzeWorkflow(wf.id, async () => analysis);
    const waiting = await engine.executeWorkflow(wf.id, user);
    const confirmation = await engine.resolveApproval(waiting.approvals[0].id, "APPROVED", 0, approver);
    vi.spyOn(getTool("demo.email.simulate"), "execute").mockRejectedValueOnce(new Error("Simulation failed"));
    await expect(engine.resolveApproval(confirmation.approvals.find(a => a.status === "PENDING")!.id, "APPROVED", 0, user)).rejects.toThrow();
    const snapshot = engine.getSnapshot(wf.id); expect(snapshot.workflow.status).toBe("FAILED");
    expect(snapshot.nodes.find(n => n.actionType === "demo.email.simulate")?.status).toBe("FAILED");
    expect(snapshot.events.some(e => e.eventType === "TOOL_FAILED" && e.action === "demo.email.simulate")).toBe(true);
  });
  it("rejects a cross-origin mutation of the local workspace", async () => {
    process.env.ACTFLOW_DEMO_AUTH = "true";
    await expect(resolveSessionActor(new Request("http://localhost:3000/api/settings", { method: "POST", headers: { origin: "https://untrusted.example" } }))).rejects.toThrow();
  });
  it("uses the browser-facing Host when Next supplies an internal localhost URL", async () => {
    process.env.ACTFLOW_DEMO_AUTH = "true";
    const actor = await resolveSessionActor(new Request("http://localhost:3100/api/settings", { method: "POST", headers: { origin: "http://127.0.0.1:3100", host: "127.0.0.1:3100" } }));
    expect(actor.role).toBe("USER");
  });
});
