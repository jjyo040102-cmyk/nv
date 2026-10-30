import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync,writeFileSync,readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import type Database from "better-sqlite3";
import { openDatabase } from "../../lib/db";
import { runMigrations } from "../../lib/db/migrate";
import { WorkflowRepository } from "../../lib/db/repository";
import { ArtifactWorkspace } from "../../lib/artifacts/workspace";

const roots: string[] = [];
const databases: Database.Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected cleanup target");
    rmSync(root, { recursive: true, force: true });
  }
});
function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "actflow-rollback-"));
  roots.push(root);
  const db = openDatabase({ dataDir: root, dbPath: ":memory:", demoAuth: true, maxUploadMb: 25 });
  databases.push(db);
  runMigrations(db);
  const workflow = new WorkflowRepository(db).createWorkflow({ sourceName: "notice.txt" });
  db.prepare("UPDATE workflows SET status='WAITING' WHERE id=?").run(workflow.id);
  return { root, db, workflow };
}

describe("physical rollback", () => {
  it("compensates files already committed by a failed episode and is idempotent",async()=>{
    const {root,db,workflow}=fixture(),workspace=new ArtifactWorkspace(db,root);
    const first=await workspace.writeTemporaryArtifact({workflowId:workflow.id,displayName:'first.docx',bytes:Buffer.from('first'),createdByNode:'first'});
    const committed=await workspace.commitTemporaryArtifact(first.id);
    const last=await workspace.writeTemporaryArtifact({workflowId:workflow.id,displayName:'last.xlsx',bytes:Buffer.from('last'),createdByNode:'last'});
    db.prepare("UPDATE workflows SET status='FAILED' WHERE id=?").run(workflow.id);
    const result=await workspace.compensateFailedEpisode(workflow.id);
    expect(result.status).toBe('ROLLED_BACK');expect(result.deleted).toHaveLength(2);
    expect(existsSync(resolve(root,committed.relativePath))).toBe(false);expect(existsSync(resolve(root,last.relativePath))).toBe(false);
    expect((await workspace.compensateFailedEpisode(workflow.id)).deleted).toEqual([]);
  });
  it("preserves user-modified committed files, including on a later temporary cleanup",async()=>{
    const {root,db,workflow}=fixture(),workspace=new ArtifactWorkspace(db,root);
    const file=await workspace.writeTemporaryArtifact({workflowId:workflow.id,displayName:'changed.docx',bytes:Buffer.from('first'),createdByNode:'first'});
    const committed=await workspace.commitTemporaryArtifact(file.id),path=resolve(root,committed.relativePath);
    writeFileSync(path,'owner edited this');db.prepare("UPDATE workflows SET status='FAILED' WHERE id=?").run(workflow.id);
    expect((await workspace.compensateFailedEpisode(workflow.id)).status).toBe('ROLLBACK_FAILED');
    expect(workspace.getArtifact(file.id)?.state).toBe('COMMITTED');
    await workspace.rollbackTemporaryArtifacts(workflow.id);expect(readFileSync(path,'utf8')).toBe('owner edited this');
  });
  it("returns new remaining-file evidence on every failed retry without transitioning FAILED again", async () => {
    const { root, db, workflow } = fixture();
    const failing = new ArtifactWorkspace(db, root, { unlink: async () => { throw new Error("still locked"); } });
    const artifact = await failing.writeTemporaryArtifact({ workflowId: workflow.id, displayName: "draft.docx", bytes: new Uint8Array([1]), createdByNode: "n1" });
    await failing.rollbackTemporaryArtifacts(workflow.id);
    const result = await failing.rollbackTemporaryArtifacts(workflow.id);
    expect(result).toMatchObject({ status: "ROLLBACK_FAILED", remainingFiles: [artifact.relativePath], errors: ["still locked"] });
    expect(new WorkflowRepository(db).getWorkflow(workflow.id)?.status).toBe("FAILED");
    expect(db.prepare("SELECT event_json FROM recorder_events WHERE event_type='ROLLBACK_FAILED'").all()).toHaveLength(2);
    expect(existsSync(resolve(root, artifact.relativePath))).toBe(true);
  });
  it("records a cleanup failure for temporary files left by an already failed execution", async () => {
    const { root, db, workflow } = fixture();
    db.prepare("UPDATE workflows SET status='FAILED',error_code='TOOL_FAILED' WHERE id=?").run(workflow.id);
    const failing = new ArtifactWorkspace(db, root, { unlink: async () => { throw new Error("locked after tool failure"); } });
    const artifact = await failing.writeTemporaryArtifact({ workflowId: workflow.id, displayName: "draft.docx", bytes: new Uint8Array([1]), createdByNode: "n1" });
    const result = await failing.rollbackTemporaryArtifacts(workflow.id);
    expect(result.remainingFiles).toEqual([artifact.relativePath]);
    expect(db.prepare("SELECT event_type FROM recorder_events").all()).toEqual([{ event_type: "ROLLBACK_FAILED" }]);
  });
  it("unlinks temporary files before reporting success", async () => {
    const { root, db, workflow } = fixture();
    const workspace = new ArtifactWorkspace(db, root);
    const artifact = await workspace.writeTemporaryArtifact({ workflowId: workflow.id, displayName: "draft.docx", bytes: new Uint8Array([1]), createdByNode: "n1" });
    const result = await workspace.rollbackTemporaryArtifacts(workflow.id);
    expect(result.status).toBe("ROLLED_BACK");
    expect(existsSync(resolve(root, artifact.relativePath))).toBe(false);
    expect(workspace.getArtifact(artifact.id)?.state).toBe("DELETED");
  });
  it("records deletion failure, leaves the file visible, and fails the workflow", async () => {
    const { root, db, workflow } = fixture();
    const writer = new ArtifactWorkspace(db, root);
    const artifact = await writer.writeTemporaryArtifact({ workflowId: workflow.id, displayName: "draft.docx", bytes: new Uint8Array([1]), createdByNode: "n1" });
    const failing = new ArtifactWorkspace(db, root, { unlink: async () => { throw new Error("injected delete failure"); } });
    const result = await failing.rollbackTemporaryArtifacts(workflow.id);
    expect(result.status).toBe("ROLLBACK_FAILED");
    expect(result.remainingFiles).toContain(artifact.relativePath);
    expect(existsSync(resolve(root, artifact.relativePath))).toBe(true);
    expect(failing.getArtifact(artifact.id)?.state).toBe("DELETE_FAILED");
    expect(new WorkflowRepository(db).getWorkflow(workflow.id)?.status).toBe("FAILED");
  });
});
