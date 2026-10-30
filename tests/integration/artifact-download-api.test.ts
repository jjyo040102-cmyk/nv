import { afterEach, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { GET } from "../../app/api/artifacts/[id]/route";
import { getRuntime, resetRuntimeForTests } from "../../lib/api/runtime";
import { DemoProvider, OFFICIAL_DEMO_TEXT } from "../../lib/providers/demo";

afterEach(() => { resetRuntimeForTests(); delete process.env.ACTFLOW_DB_PATH; });
describe("verified artifact download", () => {
  it("rejects temporary files, serves committed verified output, and detects later tampering", async () => {
    process.env.ACTFLOW_DB_PATH = ":memory:"; process.env.ACTFLOW_DEMO_AUTH = "true"; resetRuntimeForTests();
    const app = getRuntime();
    const wf = app.repo.createWorkflow({ sourceName: "notice.txt", sourceText: OFFICIAL_DEMO_TEXT, preExecutionEnabled: true, executionMode: "PRE_EXECUTION" });
    await app.engine.analyzeWorkflow(wf.id, async () => new DemoProvider().analyzeDocument({ text: OFFICIAL_DEMO_TEXT, sourceName: "notice.txt" }));
    const actor = { id: "demo-user", sessionId: "actflow-local-demo", role: "USER" as const };
    const waiting = await app.engine.executeWorkflow(wf.id, actor);
    const artifact = waiting.artifacts[0];
    const request = () => new Request(`http://localhost/api/artifacts/${artifact.id}`);
    expect((await GET(request(), { params: Promise.resolve({ id: artifact.id }) })).status).toBe(409);
    const approved = await app.engine.resolveApproval(waiting.approvals[0].id, "APPROVED", 0, { ...actor, id: "demo-approver", role: "APPROVER" });
    const response = await GET(request(), { params: Promise.resolve({ id: artifact.id }) });
    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(100);
    app.db.prepare("UPDATE workflows SET owner_session_id=? WHERE id=?").run("another-session", wf.id);
    expect((await GET(request(), { params: Promise.resolve({ id: artifact.id }) })).status).toBe(403);
    app.db.prepare("UPDATE workflows SET owner_session_id=? WHERE id=?").run(actor.sessionId, wf.id);
    const committed = approved.artifacts.find(a => a.id === artifact.id)!;
    writeFileSync(resolve(app.config.dataDir, committed.relativePath), "tampered");
    expect((await GET(request(), { params: Promise.resolve({ id: artifact.id }) })).status).toBe(409);
  });
});
