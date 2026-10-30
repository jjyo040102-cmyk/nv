import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { POST as upload } from "../../app/api/workflows/route";
import { POST as analyze } from "../../app/api/workflows/[id]/analyze/route";
import { GET as getWorkflow } from "../../app/api/workflows/[id]/route";
import { getRuntime, resetRuntimeForTests } from "../../lib/api/runtime";
import { DemoProvider, OFFICIAL_DEMO_TEXT } from "../../lib/providers/demo";

beforeEach(() => { process.env.ACTFLOW_DB_PATH = ":memory:"; process.env.ACTFLOW_DEMO_AUTH = "true"; resetRuntimeForTests(); getRuntime().repo.updateSettings({ providerId: "demo", model: "actflow-demo-v1" }); });
afterEach(() => { vi.restoreAllMocks(); resetRuntimeForTests(); delete process.env.ACTFLOW_DB_PATH; });
async function create() {
  const form = new FormData(); form.set("file", new File([readFileSync("data/demo/training-notice.txt") as BlobPart], "training-notice.txt", { type: "text/plain" }));
  const response = await upload(new Request("http://localhost/api/workflows", { method: "POST", body: form }));
  return (await response.json()).workflow.id as string;
}
describe("workflow analyze route", () => {
  it("keeps the winning Analyze settings when a concurrent opposing request receives 409", async () => {
    const id = await create();
    const value = await new DemoProvider().analyzeDocument({ text: OFFICIAL_DEMO_TEXT, sourceName: "training-notice.txt" });
    let started!: () => void, finish!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const provider = vi.spyOn(DemoProvider.prototype, "analyzeDocument").mockImplementation(async () => { started(); await gate; return value; });
    const request = (executionMode: "MANUAL" | "PRE_EXECUTION") => new Request(`http://localhost/api/workflows/${id}/analyze`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ executionMode, preExecutionEnabled: executionMode === "PRE_EXECUTION" })
    });
    const first = analyze(request("MANUAL"), { params: Promise.resolve({ id }) });
    await entered;
    const competing = await analyze(request("PRE_EXECUTION"), { params: Promise.resolve({ id }) });
    finish(); const accepted = await first;
    expect(competing.status).toBe(409); expect(accepted.status).toBe(200); expect(provider).toHaveBeenCalledTimes(1);
    expect((await accepted.json()).snapshot.workflow).toMatchObject({ executionMode: "MANUAL", preExecutionEnabled: false });
    const waiting = await getRuntime().engine.executeWorkflow(id, { id: "demo-user", sessionId: "actflow-local-demo", role: "USER" });
    expect(waiting.artifacts).toHaveLength(0);
  });
  it("persists the graph and reports zero executed actions", async () => {
    const id = await create();
    const route = new Request(`http://localhost/api/workflows/${id}/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    const response = await analyze(route, { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ executedActions: 0, message: "아직 실행된 작업이 없습니다.", providerMode: "demo", realModelCalled: false });
    expect(body.snapshot.nodes.length).toBeGreaterThan(0);
    expect(getRuntime().engine.getSnapshot(id).events.some(event => event.eventType === "TOOL_EXECUTED")).toBe(false);
    expect((await getWorkflow(new Request(`http://localhost/api/workflows/${id}`), { params: Promise.resolve({ id }) })).status).toBe(200);
    const repeat = await analyze(new Request(`http://localhost/api/workflows/${id}/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) }), { params: Promise.resolve({ id }) });
    expect(repeat.status).toBe(200);
    expect(getRuntime().engine.getSnapshot(id).events.filter(event => event.eventType === "ANALYZED")).toHaveLength(1);
  });
});
