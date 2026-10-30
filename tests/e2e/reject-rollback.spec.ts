import { existsSync } from "node:fs";
import { test, expect, createDemo, analyzeAndExecute, snapshot, artifactPath } from "./fixtures";
test("rejection physically deletes speculative files and retains rollback evidence", async ({ page }) => {
  const id = await createDemo(page, true); await analyzeAndExecute(page); const before = await snapshot(page.request, id);
  await page.getByLabel("데모 역할").selectOption("APPROVER"); await expect(page.getByRole("button", { name: "거절", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "거절", exact: true }).click(); await page.getByRole("button", { name: "거절하고 폐기" }).click();
  await expect(page.getByText("물리 삭제 완료", { exact: true })).toHaveCount(2);
  const after = await snapshot(page.request, id); expect(after.workflow.status).toBe("FAILED");
  expect(after.artifacts.every(a => a.state === "DELETED")).toBe(true); expect(before.artifacts.every(a => !existsSync(artifactPath(a.relativePath)))).toBe(true);
  expect(after.events.some(event => event.eventType === "ROLLBACK_COMPLETED")).toBe(true); expect(after.events.some(event => event.action === "demo.email.simulate" && event.eventType === "TOOL_EXECUTED")).toBe(false);
});
