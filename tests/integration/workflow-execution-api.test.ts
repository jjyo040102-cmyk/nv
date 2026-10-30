import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { POST as upload } from "../../app/api/workflows/route";
import { POST as analyze } from "../../app/api/workflows/[id]/analyze/route";
import { POST as execute } from "../../app/api/workflows/[id]/execute/route";
import { POST as pause } from "../../app/api/workflows/[id]/pause/route";
import { POST as resume } from "../../app/api/workflows/[id]/resume/route";
import { POST as discard } from "../../app/api/workflows/[id]/discard-temporary/route";
import { getRuntime, resetRuntimeForTests } from "../../lib/api/runtime";

beforeEach(() => { process.env.ACTFLOW_DB_PATH = ":memory:"; process.env.ACTFLOW_DEMO_AUTH = "true"; resetRuntimeForTests(); getRuntime().repo.updateSettings({ providerId: "demo", model: "actflow-demo-v1" }); });
afterEach(() => { resetRuntimeForTests(); delete process.env.ACTFLOW_DB_PATH; });
async function ready(pre = false) {
  const form = new FormData(); form.set("file", new File([readFileSync("data/demo/training-notice.txt") as BlobPart], "notice.txt", { type: "text/plain" }));
  const created = await upload(new Request("http://localhost/api/workflows", { method: "POST", body: form }));
  const id = (await created.json()).workflow.id as string;
  await analyze(new Request(`http://localhost/api/workflows/${id}/analyze`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ executionMode: pre ? "PRE_EXECUTION" : "MANUAL", preExecutionEnabled: pre }) }), { params: Promise.resolve({ id }) });
  return id;
}
function post(id: string, action: string) { return new Request(`http://localhost/api/workflows/${id}/${action}`, { method: "POST" }); }
describe("workflow execution routes", () => {
  it("requires an explicit Execute and rejects duplicate Execute", async () => {
    const id = await ready();
    expect(getRuntime().engine.getSnapshot(id).workflow.status).toBe("ANALYZED");
    const response = await execute(post(id, "execute"), { params: Promise.resolve({ id }) });
    expect((await response.json()).snapshot.workflow.status).toBe("WAITING");
    expect((await execute(post(id, "execute"), { params: Promise.resolve({ id }) })).status).toBe(409);
    expect(getRuntime().engine.getSnapshot(id).events.filter(event => event.eventType === "EXECUTE_REQUESTED")).toHaveLength(1);
  });
  it("prepares local files, supports pause/resume and discards temporary files truthfully", async () => {
    const id = await ready(true);
    await execute(post(id, "execute"), { params: Promise.resolve({ id }) });
    expect(getRuntime().engine.getSnapshot(id).artifacts.map(a => a.state)).toEqual(["TEMPORARY", "TEMPORARY"]);
    expect((await pause(post(id, "pause"), { params: Promise.resolve({ id }) })).status).toBe(200);
    expect((await resume(post(id, "resume"), { params: Promise.resolve({ id }) })).status).toBe(200);
    const response = await discard(post(id, "discard-temporary"), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    expect((await response.json()).rollback.status).toBe("ROLLED_BACK");
    expect(getRuntime().engine.getSnapshot(id).artifacts.every(a => a.state === "DELETED")).toBe(true);
  });
});
