import { existsSync } from "node:fs";
import { test, expect, createDemo, analyzeAndExecute, snapshot, artifactPath } from "./fixtures";
test("malformed output stops after one repair and never reaches execution", async ({ page }) => {
  const id = await createDemo(page);
  expect((await page.request.post("/api/test/faults", { headers: { "x-actflow-test-secret": "actflow-e2e-only" }, data: { workflowId: id, fault: "malformed-provider" } })).ok()).toBe(true);
  await page.getByRole("button", { name: "문서 분석" }).click(); await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  const state = await snapshot(page.request, id); expect(state.workflow.errorCode).toBe("PROVIDER_ERROR"); expect(state.nodes).toHaveLength(0); expect(state.events.some(e => e.eventType === "TOOL_EXECUTED")).toBe(false);
  const faultState = await page.request.get(`/api/test/faults?workflowId=${id}`, { headers: { "x-actflow-test-secret": "actflow-e2e-only" } }); expect((await faultState.json()).attempts).toBe(2);
  expect((await page.request.post(`/api/workflows/${id}/execute`)).status()).toBe(409);
});
test("traversal and duplicate decisions are rejected without duplicate action", async ({ page }) => {
  const traversal = await page.request.post("/api/workflows", { multipart: { file: { name: "..／escape.txt", mimeType: "text/plain", buffer: Buffer.from("unsafe") } } }); expect(traversal.status()).toBe(400);
  const id = await createDemo(page, true); await analyzeAndExecute(page); const waiting = await snapshot(page.request, id); const approval = waiting.approvals[0];
  await page.request.post("/api/session/actor", { data: { role: "APPROVER" } });
  const responses = await Promise.all([1, 2].map(() => page.request.post(`/api/approvals/${approval.id}/approve`, { data: { actor: "demo-approver", expectedVersion: 0 } })));
  expect(responses.map(r => r.status()).sort()).toEqual([200, 409]);
  const state = await snapshot(page.request, id); expect(state.artifacts).toHaveLength(2); expect(state.events.filter(e => e.eventType === "DECISION_RESOLVED" && e.approvalId === approval.id)).toHaveLength(1);
});
test("failed deletion remains evidenced and the UI does not claim discard success", async ({ page }) => {
  const id = await createDemo(page, true); await analyzeAndExecute(page);
  expect((await page.request.post("/api/test/faults", { headers: { "x-actflow-test-secret": "actflow-e2e-only" }, data: { workflowId: id, fault: "rollback-delete" } })).ok()).toBe(true);
  await page.getByLabel("데모 역할").selectOption("APPROVER"); await expect(page.getByRole("button", { name: "거절", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "거절", exact: true }).click(); await page.getByRole("button", { name: "거절하고 폐기" }).click();
  await expect(page.getByText("삭제 실패 · 파일 남아 있음", { exact: true })).toHaveCount(1);
  const state = await snapshot(page.request, id); expect(state.workflow.errorCode).toBe("ROLLBACK_FAILED"); expect(state.workflow.status).toBe("FAILED");
  const failed = state.artifacts.find(a => a.state === "DELETE_FAILED")!; expect(existsSync(artifactPath(failed.relativePath))).toBe(true); expect(state.events.some(e => e.eventType === "ROLLBACK_FAILED")).toBe(true);
});
