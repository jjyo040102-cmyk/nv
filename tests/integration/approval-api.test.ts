import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { POST as upload } from "../../app/api/workflows/route";
import { POST as analyze } from "../../app/api/workflows/[id]/analyze/route";
import { POST as execute } from "../../app/api/workflows/[id]/execute/route";
import { POST as approve } from "../../app/api/approvals/[id]/approve/route";
import { POST as reject } from "../../app/api/approvals/[id]/reject/route";
import { POST as confirm } from "../../app/api/workflows/[id]/confirm/route";
import { getRuntime, resetRuntimeForTests } from "../../lib/api/runtime";
import { createDemoSessionCookie } from "../../lib/security/session";

beforeEach(() => { process.env.ACTFLOW_DB_PATH = ":memory:"; process.env.ACTFLOW_DEMO_AUTH = "true"; resetRuntimeForTests(); getRuntime().repo.updateSettings({ providerId: "demo", model: "actflow-demo-v1" }); });
afterEach(() => { resetRuntimeForTests(); delete process.env.ACTFLOW_DB_PATH; });
async function waiting() {
  const form = new FormData(); form.set("file", new File([readFileSync("data/demo/training-notice.txt") as BlobPart], "notice.txt", { type: "text/plain" }));
  const id = (await (await upload(new Request("http://localhost/api/workflows", { method: "POST", body: form }))).json()).workflow.id as string;
  await analyze(new Request(`http://localhost/api/workflows/${id}/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ executionMode: "PRE_EXECUTION", preExecutionEnabled: true }) }), { params: Promise.resolve({ id }) });
  await execute(new Request(`http://localhost/api/workflows/${id}/execute`, { method: "POST" }), { params: Promise.resolve({ id }) });
  return { id, approval: getRuntime().engine.getSnapshot(id).approvals[0] };
}
function decision(id: string, action: string, actor: string, role: "USER" | "APPROVER") {
  return new Request(`http://localhost/api/approvals/${id}/${action}`, { method: "POST", headers: { "content-type": "application/json", cookie: createDemoSessionCookie(role) }, body: JSON.stringify({ actor, expectedVersion: 0 }) });
}
describe("approval and confirmation routes", () => {
  it("requires approver identity, handles stale retry, then confirms a simulated send", async () => {
    const { id, approval } = await waiting();
    expect((await approve(decision(approval.id, "approve", "demo-user", "USER"), { params: Promise.resolve({ id: approval.id }) })).status).toBe(409);
    expect((await approve(decision(approval.id, "approve", "demo-user", "APPROVER"), { params: Promise.resolve({ id: approval.id }) })).status).toBe(403);
    const result = await approve(decision(approval.id, "approve", "demo-approver", "APPROVER"), { params: Promise.resolve({ id: approval.id }) });
    expect(result.status).toBe(200);
    expect((await approve(decision(approval.id, "approve", "demo-approver", "APPROVER"), { params: Promise.resolve({ id: approval.id }) })).status).toBe(409);
    const snapshot = getRuntime().engine.getSnapshot(id);
    expect(snapshot.artifacts.every(a => a.state === "COMMITTED" && a.verificationStatus === "VERIFIED")).toBe(true);
    const confirmation = snapshot.approvals.find(a => a.kind === "CONFIRM")!;
    const request = new Request(`http://localhost/api/workflows/${id}/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approvalId: confirmation.id, actor: "demo-user", expectedVersion: 0 }) });
    expect((await confirm(request, { params: Promise.resolve({ id }) })).status).toBe(200);
    expect(getRuntime().engine.getSnapshot(id).workflow.status).toBe("COMPLETED");
    expect(getRuntime().engine.getSnapshot(id).events.some(event => event.action === "demo.email.simulate" && event.details?.sent === false && event.externalEffect === "NONE")).toBe(true);
  });
  it("reject removes temporary files", async () => {
    const { id, approval } = await waiting();
    expect((await reject(decision(approval.id, "reject", "demo-approver", "APPROVER"), { params: Promise.resolve({ id: approval.id }) })).status).toBe(200);
    const snapshot = getRuntime().engine.getSnapshot(id);
    expect(snapshot.workflow.status).toBe("FAILED");
    expect(snapshot.artifacts.every(a => a.state === "DELETED")).toBe(true);
  });
});
