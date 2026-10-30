import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../app/api/tasks/[id]/evidence/route";
import { getRuntime, resetRuntimeForTests } from "../../lib/api/runtime";
import { DemoProvider, OFFICIAL_DEMO_TEXT } from "../../lib/providers/demo";
import { NEBIUS_BASE_URL } from "../../lib/providers/presets";
import * as verifiedArtifact from "../../lib/security/verified-artifact";

const roots: string[] = [];
const actor = { id: "demo-user", sessionId: "actflow-local-demo", role: "USER" as const };
afterEach(() => {
  resetRuntimeForTests(); vi.restoreAllMocks(); vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function setup() {
  const root = mkdtempSync(resolve(tmpdir(), "actflow-evidence-")); roots.push(root);
  vi.stubEnv("ACTFLOW_DB_PATH", ":memory:"); vi.stubEnv("ACTFLOW_DATA_DIR", root); vi.stubEnv("ACTFLOW_DEMO_AUTH", "true");
  resetRuntimeForTests(); const app = getRuntime();
  const task = app.tasks.createGoal({ title: "Private customer", goal: "Private goal: hidden@example.com" }, actor);
  const workflow = app.repo.createWorkflow({ livingTaskId: task.id, sourceName: "private-customer.txt", sourceText: OFFICIAL_DEMO_TEXT, ownerSessionId: actor.sessionId });
  app.db.prepare("UPDATE living_tasks SET current_workflow_id=? WHERE id=?").run(workflow.id, task.id);
  const request = () => GET(new Request(`http://localhost/api/tasks/${task.id}/evidence`), { params: Promise.resolve({ id: task.id }) });
  return { app, task, workflow, root, request };
}
async function createFiles(context: ReturnType<typeof setup>) {
  await context.app.engine.analyzeWorkflow(context.workflow.id, async () => new DemoProvider().analyzeDocument({ text: OFFICIAL_DEMO_TEXT, sourceName: "notice.txt" }));
  const waiting = await context.app.engine.executeWorkflow(context.workflow.id, actor);
  return context.app.engine.resolveApproval(waiting.approvals[0].id, "APPROVED", 0, { ...actor, role: "APPROVER", id: "demo-approver" });
}

describe("downloadable task evidence", () => {
  it("exports current file integrity and fixture provenance without copying private content or raw records", async () => {
    const context = setup(), completed = await createFiles(context);
    const response = await context.request(); expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain('filename="actflow-evidence.json"');
    expect(response.headers.get("cache-control")).toContain("no-store");
    const text = await response.text(), report = JSON.parse(text);
    expect(report.summary).toMatchObject({ recordedModelCalls: 0, fixtureEpisodes: 1, matchedFiles: 2, failedFileChecks: 0 });
    expect(report.goal.requirements.length).toBeGreaterThan(0);
    expect(report.artifacts.every((artifact: { currentIntegrity: string }) => artifact.currentIntegrity === "MATCHED")).toBe(true);
    for (const privateValue of ["Private customer", "Private goal", "hidden@example.com", "private-customer.txt", context.root, OFFICIAL_DEMO_TEXT, ...completed.artifacts.map(artifact => artifact.displayName)]) expect(text).not.toContain(privateValue);
    const { contentSha256, ...payload } = report;
    expect(contentSha256).toBe(createHash("sha256").update(JSON.stringify(payload)).digest("hex"));
  });
  it("records a current integrity failure even when historical verification is green", async () => {
    const context = setup(), completed = await createFiles(context), artifact = completed.artifacts[0];
    writeFileSync(resolve(context.root, artifact.relativePath), "modified after verification");
    const report = await (await context.request()).json();
    expect(report.summary.failedFileChecks).toBe(1);
    expect(report.artifacts.find((row: { id: string }) => row.id === artifact.id)).toMatchObject({ recordedVerification: "VERIFIED", currentIntegrity: "FAILED" });
  });
  it("allows only matching server model metadata and receipt fields, and labels incomplete metadata unverified", async () => {
    const context = setup(), model = "nvidia/test-model";
    const metadata = { provider: "nebius", mode: "real", model, realModelCalled: true, executionLocation: "API", apiKey: "never-export-this-key",
      inference: { hostingProvider: "Nebius", modelPublisher: "NVIDIA", endpoint: NEBIUS_BASE_URL,
        receipts: [{ model, responseId: "private-response-id", observedAt: new Date().toISOString(), responseSha256: "a".repeat(64), promptTokens: 12, completionTokens: 34, raw: "never-export-this-response" }] } };
    const update = (value: unknown) => context.app.db.prepare("UPDATE workflows SET provider_json=? WHERE id=?").run(JSON.stringify(value), context.workflow.id);
    update(metadata);
    const response = await context.request(), text = await response.text(), report = JSON.parse(text);
    expect(report.summary.recordedModelCalls).toBe(1);
    expect(report.episodes[0].inference.kind).toBe("SERVER_RECORDED_NEBIUS");
    expect(report.episodes[0].inference.receipts[0]).toMatchObject({ promptTokens: 12, completionTokens: 34 });
    for (const secret of ["never-export-this-key", "never-export-this-response", "private-response-id"]) expect(text).not.toContain(secret);
    update({ ...metadata, inference: { ...metadata.inference, receipts: [{ ...metadata.inference.receipts[0], model: "nvidia/different" }] } });
    expect((await (await context.request()).json()).summary).toMatchObject({ recordedModelCalls: 0, unverifiedEpisodes: 1 });
    update({ provider: "nebius", mode: "real", realModelCalled: true });
    expect((await (await context.request()).json()).summary.recordedModelCalls).toBe(0);
    update({ ...metadata, executionLocation: undefined });
    expect((await (await context.request()).json()).summary).toMatchObject({ recordedModelCalls: 0, unverifiedEpisodes: 1 });
    update({ ...metadata, inference: { ...metadata.inference, receipts: Array.from({ length: 3 }, () => metadata.inference.receipts[0]) } });
    expect((await (await context.request()).json()).summary).toMatchObject({ recordedModelCalls: 0, unverifiedEpisodes: 1 });
    context.app.db.prepare("UPDATE workflows SET provider_json='not json' WHERE id=?").run(context.workflow.id);
    expect((await context.request()).status).toBe(200);
  });
  it("reports actual mail evidence only for a complete successful receipt and keeps simulated sends distinct", async () => {
    const context = setup(), now = new Date().toISOString();
    context.app.db.prepare(`INSERT INTO mail_outbox(id,owner_session_id,living_task_id,workflow_id,inbound_message_id,draft_hash,draft_json,requires_approval,status,result_json,created_at,updated_at)
      VALUES ('evidence-mail',?,?,?,'inbound','draft-hash','{}',0,'SENT',NULL,?,?)`).run(actor.sessionId, context.task.id, context.workflow.id, now, now);
    const update = (value: unknown) => context.app.db.prepare("UPDATE mail_outbox SET result_json=? WHERE id='evidence-mail'").run(JSON.stringify(value));
    const valid = { ok: true, sent: true, messageId: 'private-mail-message-id', externalEffect: 'ACTUAL', remoteVerified: true };
    for (const receipt of [null, { externalEffect: 'ACTUAL', remoteVerified: true }, { ...valid, ok: false }, { ...valid, sent: false }, { ...valid, messageId: '' }, { ...valid, messageId: 'invalid\nreceipt' }]) {
      update(receipt);
      const report = await (await context.request()).json();
      expect(report.mail).toEqual([{ status: 'SENT', effect: 'UNVERIFIED', sentReadbackVerified: false }]);
    }
    update({ ...valid, externalEffect: 'SIMULATED' });
    expect((await (await context.request()).json()).mail).toEqual([{ status: 'SENT', effect: 'SIMULATED', sentReadbackVerified: false }]);
    update(valid);
    const response = await context.request(), text = await response.text();
    expect(JSON.parse(text).mail).toEqual([{ status: 'SENT', effect: 'ACTUAL', sentReadbackVerified: true }]);
    expect(text).not.toContain('private-mail-message-id');
  });
  it("denies another owner and an unsigned caller when account authentication is enabled", async () => {
    const context = setup();
    context.app.db.prepare("UPDATE living_tasks SET owner_session_id='someone-else' WHERE id=?").run(context.task.id);
    expect((await context.request()).status).toBe(403);
    vi.stubEnv("ACTFLOW_DEMO_AUTH", "false");
    expect((await context.request()).status).toBe(401);
  });
  it("refuses to export a mixed snapshot when the workflow changes during file checks", async () => {
    const context = setup(); await createFiles(context);
    const original = verifiedArtifact.readVerifiedArtifact;
    vi.spyOn(verifiedArtifact, "readVerifiedArtifact").mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      context.app.db.prepare("UPDATE workflows SET version=version+1 WHERE id=?").run(context.workflow.id);
      return result;
    });
    expect((await context.request()).status).toBe(409);
  });
});
