import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../lib/db";
import { runMigrations } from "../../lib/db/migrate";
import { WorkflowRepository } from "../../lib/db/repository";

const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
const approver = { id: "demo-approver", sessionId: "demo", role: "APPROVER" as const };

function setup() {
  const db = openDatabase({ dataDir: ".", dbPath: ":memory:", demoAuth: true, maxUploadMb: 25 });
  databases.push(db);
  runMigrations(db);
  const repo = new WorkflowRepository(db);
  const workflow = repo.createWorkflow({ sourceName: "notice.txt" });
  db.prepare("UPDATE workflows SET status='WAITING' WHERE id=?").run(workflow.id);
  const approval = repo.createApproval({ workflowId: workflow.id, nodeId: "expense", kind: "APPROVAL", policyVersion: 1 });
  return { db, repo, workflow, approval };
}

describe("approval transaction", () => {
  it("rejects a stale expected version without changing the row", () => {
    const { repo, approval } = setup();
    expect(repo.resolveApproval({ approvalId: approval.id, expectedVersion: 9, decision: "APPROVED", actor: approver })).toEqual({ type: "conflict" });
    expect(repo.getApproval(approval.id)).toMatchObject({ status: "PENDING", version: 0 });
  });

  it("resolves once and rejects a duplicate or opposite decision", () => {
    const { repo, approval } = setup();
    expect(repo.resolveApproval({ approvalId: approval.id, expectedVersion: 0, decision: "APPROVED", actor: approver })).toMatchObject({ type: "resolved", approval: { status: "APPROVED", version: 1 } });
    expect(repo.resolveApproval({ approvalId: approval.id, expectedVersion: 0, decision: "REJECTED", actor: approver })).toEqual({ type: "conflict" });
    expect(repo.getApproval(approval.id)).toMatchObject({ status: "APPROVED", version: 1 });
  });

  it("rejects a USER role and a changed workflow version", () => {
    const { db, repo, workflow, approval } = setup();
    expect(repo.resolveApproval({ approvalId: approval.id, expectedVersion: 0, decision: "APPROVED", actor: { ...approver, role: "USER" } })).toEqual({ type: "conflict" });
    db.prepare("UPDATE workflows SET version=version+1 WHERE id=?").run(workflow.id);
    expect(repo.resolveApproval({ approvalId: approval.id, expectedVersion: 0, decision: "APPROVED", actor: approver })).toEqual({ type: "conflict" });
  });
  it("rejects a decision when organization policy version changed", () => {
    const { db, repo, approval } = setup();
    db.prepare("UPDATE settings SET organization_policy_version=2 WHERE id=1").run();
    expect(repo.resolveApproval({ approvalId: approval.id, expectedVersion: 0, decision: "APPROVED", actor: approver })).toEqual({ type: "conflict" });
    expect(repo.getApproval(approval.id)?.status).toBe("PENDING");
  });
});
