import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { openDatabase } from "../../lib/db";
import { runMigrations } from "../../lib/db/migrate";
import { WorkflowRepository } from "../../lib/db/repository";
import { WorkflowConflictError, WorkflowEngine } from "../../lib/workflow/engine";
import { DemoProvider, OFFICIAL_DEMO_TEXT } from "../../lib/providers/demo";

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
const analysis = await new DemoProvider().analyzeDocument({ text: OFFICIAL_DEMO_TEXT, sourceName: "notice.txt" });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function setup() {
  const root = mkdtempSync(resolve(tmpdir(), "actflow-review-race-")); roots.push(root);
  const db = openDatabase({ dataDir: root, dbPath: ":memory:", demoAuth: true, maxUploadMb: 25 }); databases.push(db); runMigrations(db);
  const workflow = new WorkflowRepository(db).createWorkflow({ sourceName: "notice.txt", sourceText: OFFICIAL_DEMO_TEXT, executionMode: "PRE_EXECUTION", preExecutionEnabled: true });
  const entered = deferred(), release = deferred(); let deletes = 0;
  const fs = { unlink: async (path: Parameters<typeof unlink>[0]) => { deletes++; entered.resolve(); await release.promise; await unlink(path); } };
  const engine = new WorkflowEngine(db, root, fs), competing = new WorkflowEngine(db, root, fs);
  return { root, db, workflow, engine, competing, entered, release, deleteCount: () => deletes };
}

describe("review regressions: workflow operation serialization", () => {
  it("rejects concurrent approval while discard owns deferred unlink, without consuming the decision", async () => {
    const { root, workflow, engine, competing, entered, release, deleteCount } = setup();
    await engine.analyzeWorkflow(workflow.id, async () => analysis);
    const waiting = await engine.executeWorkflow(workflow.id, user), approval = waiting.approvals[0];
    const discard = engine.discardTemporaryArtifacts(workflow.id, user);
    await entered.promise;
    const outcome = await competing.resolveApproval(approval.id, "APPROVED", approval.version, approver).then(() => null, error => error);
    release.resolve(); const result = await discard;
    expect(outcome).toBeInstanceOf(WorkflowConflictError);
    expect(result.rollback.status).toBe("ROLLED_BACK"); expect(deleteCount()).toBe(2);
    expect(result.snapshot.approvals[0].status).toBe("PENDING");
    expect(result.snapshot.artifacts.every(artifact => artifact.state === "DELETED")).toBe(true);
    expect(waiting.artifacts.every(artifact => !existsSync(resolve(root, artifact.relativePath)))).toBe(true);
    const fresh = result.snapshot.approvals[0];
    expect(fresh.version).toBe(approval.version + 1);
    await expect(competing.resolveApproval(approval.id, "APPROVED", approval.version, approver)).rejects.toBeInstanceOf(WorkflowConflictError);
    const continued = await competing.resolveApproval(fresh.id, "APPROVED", fresh.version, approver);
    expect(continued.artifacts.filter(artifact => artifact.state === "COMMITTED" && artifact.verificationStatus === "VERIFIED")).toHaveLength(2);
  });
  it("allows only one of two concurrent discards to touch the filesystem", async () => {
    const { workflow, engine, competing, entered, release, deleteCount } = setup();
    await engine.analyzeWorkflow(workflow.id, async () => analysis); await engine.executeWorkflow(workflow.id, user);
    const first = engine.discardTemporaryArtifacts(workflow.id, user);
    await entered.promise;
    const second = competing.discardTemporaryArtifacts(workflow.id, user).then(() => null, error => error);
    await new Promise<void>(done => setImmediate(done));
    release.resolve(); const [result, outcome] = await Promise.all([first, second]);
    expect(outcome).toBeInstanceOf(WorkflowConflictError);
    expect(result.rollback.status).toBe("ROLLED_BACK"); expect(deleteCount()).toBe(2);
  });
  it("guards rejection cleanup from a competing discard", async () => {
    const { workflow, engine, competing, entered, release, deleteCount } = setup();
    await engine.analyzeWorkflow(workflow.id, async () => analysis);
    const waiting = await engine.executeWorkflow(workflow.id, user), approval = waiting.approvals[0];
    const rejection = engine.resolveApproval(approval.id, "REJECTED", approval.version, approver);
    await entered.promise;
    const discard = competing.discardTemporaryArtifacts(workflow.id, user).then(() => null, error => error);
    await new Promise<void>(done => setImmediate(done));
    release.resolve(); const [result, outcome] = await Promise.all([rejection, discard]);
    expect(outcome).toBeInstanceOf(WorkflowConflictError);
    expect(result.workflow.errorCode).toBe("DECISION_REJECTED"); expect(deleteCount()).toBe(2);
  });
  it("shares the analysis guard across engines using the same runtime database", async () => {
    const { workflow, engine, competing } = setup(), entered = deferred(), release = deferred(); let calls = 0;
    const first = engine.analyzeWorkflow(workflow.id, async () => { calls++; entered.resolve(); await release.promise; return analysis; }).then(result => result, error => error);
    await entered.promise;
    const second = await competing.analyzeWorkflow(workflow.id, async () => { calls++; return analysis; }).then(() => null, error => error);
    release.resolve(); await first;
    expect(second).toBeInstanceOf(WorkflowConflictError); expect(calls).toBe(1);
  });
});
