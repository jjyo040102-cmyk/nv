import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import type Database from "better-sqlite3";
import type { ArtifactState } from "../domain/types";
import { transitionWorkflow } from "../workflow/state-machine";
import { WorkflowRepository } from "../db/repository";

export type WorkspaceArea = "source" | "temporary" | "committed" | "evidence";
export type ArtifactRecord = {
  id: string; workflowId: string; nodeId: string; displayName: string; relativePath: string;
  state: ArtifactState; byteSize: number; sha256: string | null; contentType: string;
  preparationKey: string | null; verificationStatus: "PENDING" | "VERIFIED" | "FAILED";
  createdAt: string; updatedAt: string;
};
export type RollbackResult = { status: "ROLLED_BACK" | "ROLLBACK_FAILED"; deleted: string[]; remainingFiles: string[]; errors: string[] };
type ArtifactRow = {
  id: string; workflow_id: string; node_id: string; display_name: string; relative_path: string;
  state: ArtifactState; byte_size: number; sha256: string | null; content_type: string;
  preparation_key: string | null; verification_status: "PENDING" | "VERIFIED" | "FAILED";
  created_at: string; updated_at: string;
};
function mapArtifact(row: ArtifactRow): ArtifactRecord {
  return { id: row.id, workflowId: row.workflow_id, nodeId: row.node_id, displayName: row.display_name,
    relativePath: row.relative_path, state: row.state, byteSize: row.byte_size, sha256: row.sha256,
    contentType: row.content_type, preparationKey: row.preparation_key, verificationStatus: row.verification_status,
    createdAt: row.created_at, updatedAt: row.updated_at };
}

function safeSegment(value: string, kind: "workflow" | "file"): string {
  if (!value || value !== value.trim() || value === "." || value === ".." || value.includes("..") ||
      /[\\/\u2215\u2044\uff0f\uff3c:\x00-\x1f]/u.test(value) || isAbsolute(value) ||
      value.normalize("NFKC") !== value || value.endsWith(".") ||
      /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value)) {
    throw new Error(`Unsafe ${kind} name`);
  }
  if (kind === "workflow" && !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) throw new Error("Unsafe workflow id");
  if (kind === "file" && value.length > 180) throw new Error("File name too long");
  return value;
}

export function resolveWorkspacePath(root: string, workflowId: string, area: WorkspaceArea, displayName: string): string {
  safeSegment(workflowId, "workflow");
  safeSegment(displayName, "file");
  if (!["source", "temporary", "committed", "evidence"].includes(area)) throw new Error("Unsafe workspace area");
  const base = resolve(root, workflowId, area);
  const target = resolve(base, displayName);
  const rel = relative(base, target);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw new Error("Workspace path escapes root");
  return target;
}

async function ensureDirectories(root: string, workflowId: string): Promise<void> {
  safeSegment(workflowId, "workflow");
  const paths = [resolve(root), resolve(root, workflowId), ...(["source", "temporary", "committed", "evidence"] as const).map(area => resolve(root, workflowId, area))];
  for (const path of paths) {
    await mkdir(path, { recursive: true });
    if ((await lstat(path)).isSymbolicLink()) throw new Error("Symbolic links are not allowed in workspace paths");
  }
}

function contentType(name: string): string {
  switch (extname(name).toLowerCase()) {
    case ".xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default: return "application/octet-stream";
  }
}

export class ArtifactWorkspace {
  constructor(private readonly db: Database.Database, private readonly root: string, private readonly fs: { unlink: typeof unlink } = { unlink }) {}

  getArtifact(id: string): ArtifactRecord | null {
    const row = this.db.prepare("SELECT * FROM artifacts WHERE id=?").get(id) as ArtifactRow | undefined;
    return row ? mapArtifact(row) : null;
  }

  listArtifacts(workflowId: string): ArtifactRecord[] {
    return (this.db.prepare("SELECT * FROM artifacts WHERE workflow_id=? ORDER BY created_at,id").all(workflowId) as ArtifactRow[]).map(mapArtifact);
  }

  private absolutePath(artifact: ArtifactRecord): string {
    const parts = artifact.relativePath.split("/");
    if (parts.length !== 3 || parts[0] !== artifact.workflowId || !["temporary", "committed"].includes(parts[1])) throw new Error("Invalid stored artifact path");
    return resolveWorkspacePath(this.root, artifact.workflowId, parts[1] as WorkspaceArea, parts[2]);
  }

  async writeTemporaryArtifact(input: { workflowId: string; displayName: string; bytes: Uint8Array; createdByNode: string; preparationKey?: string }): Promise<ArtifactRecord> {
    safeSegment(input.displayName, "file");
    await ensureDirectories(this.root, input.workflowId);
    const id = randomUUID();
    const storageName = `${id}${extname(input.displayName).toLowerCase()}`;
    const path = resolveWorkspacePath(this.root, input.workflowId, "temporary", storageName);
    const bytes = Buffer.from(input.bytes);
    await writeFile(path, bytes, { flag: "wx" });
    const now = new Date().toISOString();
    const relativePath = [input.workflowId, "temporary", storageName].join("/");
    try {
      this.db.prepare("INSERT INTO artifacts(id,workflow_id,node_id,display_name,relative_path,state,byte_size,sha256,content_type,preparation_key,created_at,updated_at) VALUES (?,?,?,?,?,'TEMPORARY',?,?,?,?,?,?)")
        .run(id, input.workflowId, input.createdByNode, input.displayName, relativePath, bytes.byteLength, createHash("sha256").update(bytes).digest("hex"), contentType(input.displayName), input.preparationKey ?? null, now, now);
    } catch (error) {
      await unlink(path);
      throw error;
    }
    return this.getArtifact(id)!;
  }

  async commitTemporaryArtifact(artifactId: string, expectedSha256?: string): Promise<ArtifactRecord> {
    const artifact = this.getArtifact(artifactId);
    if (!artifact || artifact.state !== "TEMPORARY") throw new Error("Artifact is not temporary");
    await ensureDirectories(this.root, artifact.workflowId);
    const from = this.absolutePath(artifact);
    const storageName = artifact.relativePath.split("/")[2];
    const to = resolveWorkspacePath(this.root, artifact.workflowId, "committed", storageName);
    const assertUnchanged = async (path: string) => {
      const file = await lstat(path);
      if (!file.isFile() || file.isSymbolicLink() || file.size !== artifact.byteSize || file.size > 25 * 1024 * 1024) throw new Error("Artifact changed before commit");
      const hash = createHash("sha256").update(await readFile(path)).digest("hex");
      if (hash !== artifact.sha256 || expectedSha256 && hash !== expectedSha256) throw new Error("Artifact changed before commit");
    };
    await assertUnchanged(from);
    if (existsSync(to)) throw new Error("Committed artifact already exists");
    await rename(from, to);
    const relativePath = [artifact.workflowId, "committed", storageName].join("/");
    try {
      await assertUnchanged(to);
      const result = this.db.prepare("UPDATE artifacts SET relative_path=?,state='COMMITTED',updated_at=? WHERE id=? AND state='TEMPORARY'")
        .run(relativePath, new Date().toISOString(), artifactId);
      if (result.changes !== 1) throw new Error("Artifact commit conflict");
    } catch (error) {
      try { await rename(to, from); }
      catch (restoreError) {
        // The file remains in committed storage but was never published in the DB.
        // Track its actual location so cleanup cannot keep chasing the missing old path.
        const actualRelativePath = existsSync(to) ? relativePath : artifact.relativePath;
        try {
          this.db.prepare("UPDATE artifacts SET relative_path=?,state='DELETE_FAILED',verification_status='FAILED',updated_at=? WHERE id=?")
            .run(actualRelativePath, new Date().toISOString(), artifactId);
          const recovery = { eventType: "ARTIFACT_COMMIT_RECOVERY_REQUIRED", artifactId, remainingFiles: [actualRelativePath],
            errors: [error, restoreError].map(value => value instanceof Error ? value.message : "Unknown commit/restore error") };
          this.db.prepare("INSERT INTO recorder_events(id,workflow_id,event_type,event_json,created_at) VALUES (?,?,?,?,?)")
            .run(randomUUID(), artifact.workflowId, recovery.eventType, JSON.stringify(recovery), new Date().toISOString());
        } catch (trackingError) {
          throw new AggregateError([error, restoreError, trackingError], `Artifact commit recovery requires inspection of ${actualRelativePath}`);
        }
        throw new AggregateError([error, restoreError], "Artifact commit failed and its temporary location could not be restored");
      }
      throw error;
    }
    return this.getArtifact(artifactId)!;
  }

  async rollbackTemporaryArtifacts(workflowId: string): Promise<RollbackResult> {
    const artifacts = this.listArtifacts(workflowId).filter(artifact => artifact.state === "TEMPORARY" || artifact.state === "DELETE_FAILED");
    const deleted: string[] = [];
    const errors: string[] = [];
    for (const artifact of artifacts) {
      try {
        await this.assertRecoverable(artifact);
        const path = this.absolutePath(artifact);
        try { await this.fs.unlink(path); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
        if (existsSync(path)) throw new Error("File remains after unlink");
        this.db.prepare("UPDATE artifacts SET state='DELETED',updated_at=? WHERE id=?").run(new Date().toISOString(), artifact.id);
        deleted.push(artifact.relativePath);
      } catch (error) {
        this.db.prepare("UPDATE artifacts SET state='DELETE_FAILED',updated_at=? WHERE id=?").run(new Date().toISOString(), artifact.id);
        errors.push(error instanceof Error ? error.message : "Unknown deletion error");
      }
    }
    const remainingFiles = this.listArtifacts(workflowId).filter(artifact => artifact.state === "TEMPORARY" || artifact.state === "DELETE_FAILED").map(artifact => artifact.relativePath);
    if (errors.length) {
      const workflow = new WorkflowRepository(this.db).getWorkflow(workflowId);
      if (workflow) {
        if (workflow.status !== "FAILED") transitionWorkflow(workflow.status, "FAILED");
        this.db.prepare("UPDATE workflows SET status='FAILED',error_code='ROLLBACK_FAILED',error_message=?,version=version+1,updated_at=? WHERE id=?")
          .run("임시 파일을 모두 삭제하지 못했습니다.", new Date().toISOString(), workflowId);
      }
      const event = { eventType: "ROLLBACK_FAILED", remainingFiles, errors };
      this.db.prepare("INSERT INTO recorder_events(id,workflow_id,event_type,event_json,created_at) VALUES (?,?,?,?,?)")
        .run(randomUUID(), workflowId, "ROLLBACK_FAILED", JSON.stringify(event), new Date().toISOString());
    }
    return { status: errors.length ? "ROLLBACK_FAILED" : "ROLLED_BACK", deleted, remainingFiles, errors };
  }

  private async assertRecoverable(artifact: ArtifactRecord): Promise<void> {
    await ensureDirectories(this.root,artifact.workflowId);
    const references = this.db.prepare("SELECT draft_json FROM mail_outbox").all() as Array<{draft_json:string}>;
    if (references.some(row => (JSON.parse(row.draft_json).artifactIds ?? []).includes(artifact.id))) throw new Error("Artifact is bound to an external action");
    try {
      const path = this.absolutePath(artifact), stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unexpected artifact file type");
      // Temporary outputs are unpublished scratch files; committed files may have been edited by their owner.
      if (artifact.relativePath.split('/')[1] === 'committed' && (stat.size !== artifact.byteSize || stat.size > 25 * 1024 * 1024 || createHash("sha256").update(await readFile(path)).digest("hex") !== artifact.sha256)) throw new Error("Artifact changed; automatic recovery stopped");
    } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  }

  /** Compensate this failed episode's own generated files, newest first. Never delete shared/sent or modified files. */
  async compensateFailedEpisode(workflowId: string): Promise<RollbackResult> {
    const workflow = new WorkflowRepository(this.db).getWorkflow(workflowId);
    if (!workflow || workflow.status !== "FAILED") throw new Error("Only failed episodes may be compensated");
    const artifacts = this.listArtifacts(workflowId).filter(artifact => artifact.state !== "DELETED").reverse();
    const deleted: string[] = [], remainingFiles: string[] = [], errors: string[] = [];
    for (const artifact of artifacts) {
      try {
        await this.assertRecoverable(artifact);
        const path = this.absolutePath(artifact);
        try {
          await this.fs.unlink(path);
          if (existsSync(path)) throw new Error("File remains after compensation");
        } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
        this.db.prepare("UPDATE artifacts SET state='DELETED',updated_at=? WHERE id=?").run(new Date().toISOString(), artifact.id);
        const event = { eventType: "ARTIFACT_COMPENSATED", artifactId: artifact.id, previousState: artifact.state, file: artifact.relativePath, externalEffect: "NONE" };
        this.db.prepare("INSERT INTO recorder_events(id,workflow_id,event_type,event_json,created_at) VALUES (?,?,?,?,?)").run(randomUUID(), workflowId, event.eventType, JSON.stringify(event), new Date().toISOString());
        deleted.push(artifact.relativePath);
      } catch (error) {
        // Preserve committed state so a later temporary-file cleanup cannot bypass the recovery check.
        if (artifact.state !== 'COMMITTED') this.db.prepare("UPDATE artifacts SET state='DELETE_FAILED',updated_at=? WHERE id=?").run(new Date().toISOString(), artifact.id);
        remainingFiles.push(artifact.relativePath); errors.push(error instanceof Error ? error.message : "Recovery failed");
        const event = {eventType:'ARTIFACT_COMPENSATION_BLOCKED',artifactId:artifact.id,file:artifact.relativePath,reason:errors.at(-1)};
        this.db.prepare("INSERT INTO recorder_events(id,workflow_id,event_type,event_json,created_at) VALUES (?,?,?,?,?)").run(randomUUID(),workflowId,event.eventType,JSON.stringify(event),new Date().toISOString());
      }
    }
    if (errors.length) this.db.prepare("UPDATE workflows SET error_code='ROLLBACK_FAILED',error_message=?,updated_at=? WHERE id=?").run("자동 복구하지 못한 파일이 남아 있습니다. 기록을 확인하세요.", new Date().toISOString(), workflowId);
    return { status: errors.length ? "ROLLBACK_FAILED" : "ROLLED_BACK", deleted, remainingFiles, errors };
  }
}
