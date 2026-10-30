import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import type Database from "better-sqlite3";
import { openDatabase } from "../../lib/db";
import { runMigrations } from "../../lib/db/migrate";
import { WorkflowRepository } from "../../lib/db/repository";
import { ArtifactWorkspace, resolveWorkspacePath } from "../../lib/artifacts/workspace";

const faults = vi.hoisted(() => ({ reverseRenameFails: false }));
vi.mock("node:fs/promises", async importActual => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  return { ...actual, rename: async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
    if (faults.reverseRenameFails && String(to).replaceAll("\\", "/").includes("/temporary/")) throw new Error("Synthetic reverse rename lock");
    return actual.rename(from, to);
  } };
});

const roots: string[] = [];
const databases: Database.Database[] = [];
afterEach(() => {
  faults.reverseRenameFails = false;
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected cleanup target");
    rmSync(root, { recursive: true, force: true });
  }
});
function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "actflow-workspace-"));
  roots.push(root);
  const db = openDatabase({ dataDir: root, dbPath: ":memory:", demoAuth: true, maxUploadMb: 25 });
  databases.push(db);
  runMigrations(db);
  const workflow = new WorkflowRepository(db).createWorkflow({ sourceName: "교육 안내.txt" });
  return { root, db, workflow, workspace: new ArtifactWorkspace(db, root) };
}

describe("artifact workspace", () => {
  it.each(["../secret", "..\\secret", "a/b", "a\\b", "C:\\secret", "/etc/passwd", "∕etc", "／etc", "＼etc", "", ".", "..", "CON.txt"])("rejects unsafe display name %s", name => {
    expect(() => resolveWorkspacePath(resolve(tmpdir(), "actflow"), "safe-id", "temporary", name)).toThrow();
  });
  it("keeps valid Korean names beneath the chosen workflow area", () => {
    const root = resolve(tmpdir(), "actflow");
    const path = resolveWorkspacePath(root, "safe-id", "temporary", "교육 참석자 명단.xlsx");
    expect(path.startsWith(resolve(root, "safe-id", "temporary") + sep)).toBe(true);
  });
  it("writes generated storage names and atomically commits the actual file", async () => {
    const { root, workflow, workspace } = fixture();
    const artifact = await workspace.writeTemporaryArtifact({ workflowId: workflow.id, displayName: "명단.xlsx", bytes: new Uint8Array([1, 2, 3]), createdByNode: "node-1" });
    expect(artifact.state).toBe("TEMPORARY");
    expect(artifact.relativePath).not.toContain("명단");
    expect(existsSync(resolve(root, artifact.relativePath))).toBe(true);
    const committed = await workspace.commitTemporaryArtifact(artifact.id);
    expect(committed.state).toBe("COMMITTED");
    expect(existsSync(resolve(root, artifact.relativePath))).toBe(false);
    expect(existsSync(resolve(root, committed.relativePath))).toBe(true);
  });
  it("refuses to publish bytes changed after verification", async () => {
    const { root, workflow, workspace } = fixture();
    const artifact = await workspace.writeTemporaryArtifact({ workflowId: workflow.id, displayName: "명단.xlsx", bytes: new Uint8Array([1, 2, 3]), createdByNode: "node-1" });
    writeFileSync(resolve(root, artifact.relativePath), new Uint8Array([3, 2, 1]));
    await expect(workspace.commitTemporaryArtifact(artifact.id, artifact.sha256!)).rejects.toThrow("changed");
    expect(workspace.getArtifact(artifact.id)?.state).toBe("TEMPORARY");
    expect(existsSync(resolve(root, artifact.relativePath))).toBe(true);
  });
  it("tracks the actual output when commit and reverse rename both fail, then cleans it up", async () => {
    const { root, db, workflow, workspace } = fixture();
    const artifact = await workspace.writeTemporaryArtifact({ workflowId: workflow.id, displayName: "명단.xlsx", bytes: new Uint8Array([1, 2, 3]), createdByNode: "node-1" });
    db.exec("CREATE TRIGGER reject_artifact_commit BEFORE UPDATE OF state ON artifacts WHEN NEW.state='COMMITTED' BEGIN SELECT RAISE(ABORT,'Synthetic commit conflict'); END");
    faults.reverseRenameFails = true;
    await expect(workspace.commitTemporaryArtifact(artifact.id)).rejects.toMatchObject({ name: "AggregateError", errors: [expect.any(Error), expect.any(Error)] });
    const failed = workspace.getArtifact(artifact.id)!;
    expect(failed.state).toBe("DELETE_FAILED");
    expect(failed.relativePath).toContain("/committed/");
    expect(existsSync(resolve(root, failed.relativePath))).toBe(true);
    expect(existsSync(resolve(root, artifact.relativePath))).toBe(false);
    const rollback = await workspace.rollbackTemporaryArtifacts(workflow.id);
    expect(rollback.status).toBe("ROLLED_BACK");
    expect(rollback.remainingFiles).toEqual([]);
    expect(workspace.getArtifact(artifact.id)?.state).toBe("DELETED");
    expect(existsSync(resolve(root, failed.relativePath))).toBe(false);
  });
});
