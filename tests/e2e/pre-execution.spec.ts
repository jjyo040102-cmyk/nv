import { existsSync } from "node:fs";
import { test, expect, createDemo, analyzeAndExecute, approveInBrowser, confirmInBrowser, snapshot, artifactPath, verifyFiles } from "./fixtures";
test("pre-execution keeps real temporary outputs and commits the same artifacts once", async ({ page }) => {
  const id = await createDemo(page, true); await analyzeAndExecute(page);
  const prepared = await snapshot(page.request, id); expect(prepared.artifacts).toHaveLength(2);
  expect(prepared.artifacts.every(a => a.state === "TEMPORARY" && existsSync(artifactPath(a.relativePath)))).toBe(true);
  await expect(page.getByText("준비됨 · 미확정", { exact: true })).toHaveCount(2);
  expect(prepared.events.some(event => event.action === "demo.email.simulate" && event.eventType === "TOOL_EXECUTED")).toBe(false);
  for (const artifact of prepared.artifacts) expect((await page.request.get(`/api/artifacts/${artifact.id}`)).status()).toBe(409);
  await approveInBrowser(page); const committed = await snapshot(page.request, id);
  expect(committed.artifacts.map(a => a.id).sort()).toEqual(prepared.artifacts.map(a => a.id).sort());
  expect(committed.events.filter(event => event.action?.startsWith("artifact.") && event.eventType === "TOOL_EXECUTED").every(event => event.details?.reusedPrepared)).toBe(true);
  await confirmInBrowser(page); await verifyFiles(await snapshot(page.request, id));
});
