import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { SessionActor } from "../domain/types";
import { assertTaskAccess } from "../api/task-access";
import { readVerifiedArtifact } from "../security/verified-artifact";
import { NEBIUS_BASE_URL } from "../providers/presets";
import { GoalContracts } from "./goal-contract";
import { TaskConflictError } from "./lease";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const model = z.string().regex(/^nvidia\/[A-Za-z0-9][A-Za-z0-9._-]{2,139}$/);
const opaqueId = z.string().min(1).max(500).refine(value => !/[\r\n\0]/.test(value));
const receiptSchema = z.object({
  responseId: opaqueId, model, observedAt: z.iso.datetime(), responseSha256: sha256,
  promptTokens: z.number().int().nonnegative().safe().optional(),
  completionTokens: z.number().int().nonnegative().safe().optional()
});
const liveSchema = z.object({
  provider: z.literal("nebius"), model, mode: z.literal("real"), realModelCalled: z.literal(true), executionLocation: z.literal("API"),
  inference: z.object({ hostingProvider: z.literal("Nebius"), modelPublisher: z.literal("NVIDIA"),
    endpoint: z.literal(NEBIUS_BASE_URL), receipts: z.array(receiptSchema).min(1).max(2) })
});
const mailReceiptSchema = z.object({
  ok: z.literal(true), sent: z.literal(true), messageId: opaqueId,
  externalEffect: z.enum(["ACTUAL", "SIMULATED"]), remoteVerified: z.boolean().optional()
});

function inferenceSummary(raw: string | null) {
  let value: unknown;
  try { value = JSON.parse(raw ?? "null"); } catch { value = null; }
  const parsed = liveSchema.safeParse(value);
  if (parsed.success && parsed.data.inference.receipts.every(receipt => receipt.model === parsed.data.model)) {
    return { kind: "SERVER_RECORDED_NEBIUS" as const, provider: "Nebius", publisher: "NVIDIA", model: parsed.data.model,
      receipts: parsed.data.inference.receipts.map(({ responseId, ...receipt }) => ({ ...receipt, responseIdSha256: digest(responseId) })) };
  }
  const fixture = z.object({ provider: z.literal("demo"), mode: z.literal("demo"), realModelCalled: z.literal(false) }).safeParse(value).success;
  return { kind: fixture ? "DETERMINISTIC_FIXTURE" as const : "UNVERIFIED" as const, receipts: [] };
}

type ArtifactRow = { id: string; workflowId: string; state: string; recordedVerification: string; byteSize: number; sha256: string | null };

/** Content-minimized evidence: never serialize raw goals, prompts, filenames, mail, errors or audit payloads. */
export async function exportTaskEvidence(db: Database.Database, dataDir: string, taskId: string, actor: SessionActor) {
  assertTaskAccess(db, taskId, actor);
  // Each snapshot is synchronous and transactional. Recheck after file I/O so concurrent changes cannot be mixed.
  const snapshot = () => db.transaction(() => {
    assertTaskAccess(db, taskId, actor);
    const task = db.prepare("SELECT id,status,version,current_workflow_id AS currentWorkflowId,created_at AS createdAt,updated_at AS updatedAt,completed_at AS completedAt FROM living_tasks WHERE id=? AND owner_session_id=?").get(taskId, actor.sessionId) as { id: string; status: string; version: number; currentWorkflowId: string | null; createdAt: string; updatedAt: string; completedAt: string | null };
    const contract = new GoalContracts(db).view(taskId, actor.sessionId);
    const episodes = (db.prepare("SELECT id,status,version,provider_json AS provider FROM workflows WHERE living_task_id=? AND owner_session_id=? ORDER BY created_at,rowid").all(taskId, actor.sessionId) as { id: string; status: string; version: number; provider: string | null }[])
      .map(({ provider, ...episode }) => ({ ...episode, inference: inferenceSummary(provider) }));
    const artifacts = db.prepare(`SELECT a.id,a.workflow_id AS workflowId,a.state,a.verification_status AS recordedVerification,a.byte_size AS byteSize,a.sha256
      FROM artifacts a JOIN workflows w ON w.id=a.workflow_id WHERE w.living_task_id=? AND w.owner_session_id=? ORDER BY a.created_at,a.rowid`).all(taskId, actor.sessionId) as ArtifactRow[];
    const checks = db.prepare(`SELECT v.passed,COUNT(*) AS count FROM verifications v JOIN workflows w ON w.id=v.workflow_id
      WHERE w.living_task_id=? AND w.owner_session_id=? GROUP BY v.passed ORDER BY v.passed`).all(taskId, actor.sessionId) as { passed: number; count: number }[];
    const approvals = db.prepare(`SELECT a.kind,a.status,COUNT(*) AS count FROM approvals a JOIN workflows w ON w.id=a.workflow_id
      WHERE w.living_task_id=? AND w.owner_session_id=? GROUP BY a.kind,a.status ORDER BY a.kind,a.status`).all(taskId, actor.sessionId);
    const mail = (db.prepare("SELECT status,result_json FROM mail_outbox WHERE living_task_id=? AND owner_session_id=? ORDER BY rowid").all(taskId, actor.sessionId) as { status: string; result_json: string | null }[]).map(row => {
      let value: unknown;
      try { value = JSON.parse(row.result_json ?? "null"); } catch { /* Unknown receipts never establish an effect. */ }
      const parsed = mailReceiptSchema.safeParse(value), receipt = parsed.success ? parsed.data : null;
      return { status: row.status, effect: row.status === "SENT" && receipt ? receipt.externalEffect : "UNVERIFIED",
        sentReadbackVerified: row.status === "SENT" && receipt?.externalEffect === "ACTUAL" && receipt.remoteVerified === true };
    });
    return { task, goal: contract ? { version: contract.version, goalSha256: contract.goalHash, ownerConfirmed: contract.confirmed,
      recordedReadyToComplete: contract.readyToComplete,
      requirements: contract.requirements.map(({ id, kind, passed, canConfirm }) => ({ id, kind, passed, requiresOwnerReview: !passed && canConfirm })) } : null,
      episodes, artifacts, verificationChecks: { passed: checks.find(row => row.passed === 1)?.count ?? 0, failed: checks.find(row => row.passed === 0)?.count ?? 0 }, approvals, mail };
  })();
  const captured = snapshot();
  const artifacts = [];
  for (const artifact of captured.artifacts) {
    let integrity: "MATCHED" | "FAILED" | "NOT_APPLICABLE" = "NOT_APPLICABLE";
    if (artifact.state === "COMMITTED") {
      try { await readVerifiedArtifact(db, dataDir, { artifactId: artifact.id, ownerSessionId: actor.sessionId, livingTaskId: taskId }); integrity = "MATCHED"; }
      catch { integrity = "FAILED"; }
    }
    artifacts.push({ ...artifact, currentIntegrity: integrity });
  }
  if (JSON.stringify(captured) !== JSON.stringify(snapshot())) throw new TaskConflictError("검증 중 작업이 변경됐습니다. 최신 상태에서 다시 저장하세요.");
  const recordedModelCalls = captured.episodes.reduce((sum, episode) => sum + episode.inference.receipts.length, 0);
  const evidence = { schemaVersion: "actflow.task-evidence.v1", exportedAt: new Date().toISOString(),
    scope: "Server-recorded snapshot with current committed-file hash checks; not an independent or signed attestation.",
    omitted: ["goal text", "source text", "filenames and paths", "email addresses and bodies", "credentials", "raw model responses", "raw event payloads"],
    ...captured, artifacts,
    summary: { episodes: captured.episodes.length, recordedModelCalls,
      fixtureEpisodes: captured.episodes.filter(episode => episode.inference.kind === "DETERMINISTIC_FIXTURE").length,
      unverifiedEpisodes: captured.episodes.filter(episode => episode.inference.kind === "UNVERIFIED").length,
      matchedFiles: artifacts.filter(artifact => artifact.currentIntegrity === "MATCHED").length,
      failedFileChecks: artifacts.filter(artifact => artifact.currentIntegrity === "FAILED").length,
      pendingRequirements: captured.goal?.requirements.filter(requirement => !requirement.passed).length ?? null },
    limitations: ["Historical verification is distinct from current file integrity. MATCHED rechecks bytes, not the truth of the source.",
      "Recorded model receipts can originate from HTTP mocks in tests; they alone do not prove live account access or model quality.",
      "A Gmail sent readback is not evidence of recipient delivery or reading.",
      "This snapshot can become stale after export. Review current task state before acting."] };
  return { ...evidence, contentSha256: digest(JSON.stringify(evidence)) };
}
