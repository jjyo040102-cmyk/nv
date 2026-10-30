import { test as base, expect, type Page, type APIRequestContext } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { WorkflowSnapshot } from "../../lib/workflow/engine";
import { verifyArtifact } from "../../lib/workflow/verifier";

export const test = base.extend<{ resetWorkspaceSettings: void }>({ resetWorkspaceSettings: [async ({ request }, use) => {
  await request.post("/api/session/actor", { data: { role: "USER" } });
  const response = await request.post("/api/settings", { data: { executionMode: "MANUAL", preExecutionEnabled: false, providerId: "demo", model: "actflow-demo-v1", effort: null, automationProfile: "SAFE", autoContinueEnabled: false, replanOnNewInfoEnabled: true } });
  expect(response.ok()).toBe(true);
  await use();
}, { auto: true }] });
export { expect };
export async function createDemo(page: Page, pre = false): Promise<string> {
  if (pre) expect((await page.request.post("/api/settings", { data: { executionMode: "PRE_EXECUTION", preExecutionEnabled: true } })).ok()).toBe(true);
  // Legacy workflow tests seed their source directly. The dashboard sample now starts a Living Task.
  const source = await page.request.get("/api/demo"); expect(source.ok()).toBe(true);
  const created = await page.request.post("/api/workflows", { multipart: { file: { name: "training-notice.txt", mimeType: "text/plain", buffer: Buffer.from(await source.text()) } } });
  expect(created.ok()).toBe(true);
  await page.goto(`/workflows/${(await created.json()).workflow.id}`);
  // A fresh Next development server compiles this route on the first navigation.
  await expect(page).toHaveURL(/\/workflows\/[0-9a-f-]{36}$/, { timeout: 45_000 });
  return page.url().split("/").at(-1)!;
}
export async function snapshot(request: APIRequestContext, id: string): Promise<WorkflowSnapshot> { const response = await request.get(`/api/workflows/${id}`); expect(response.ok()).toBe(true); return (await response.json()).snapshot; }
export async function analyzeAndExecute(page: Page): Promise<void> { await page.getByRole("button", { name: "문서 분석" }).click(); await expect(page.getByText("아직 실행된 작업이 없습니다.", { exact: true })).toBeVisible(); await page.getByRole("button", { name: "실행 시작" }).click(); await expect(page.getByRole("heading", { name: "승인 후 다음 단계로 진행합니다" })).toBeVisible(); }
export async function approveInBrowser(page: Page): Promise<void> { await page.getByLabel("데모 역할").selectOption("APPROVER"); await expect(page.getByRole("checkbox")).toBeEnabled(); await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "승인하고 계속" }).click(); await expect(page.getByRole("heading", { name: "실행 전 최종 확인이 필요합니다" })).toBeVisible(); }
export async function confirmInBrowser(page: Page): Promise<void> { await page.getByLabel("데모 역할").selectOption("USER"); await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "확인하고 계속" }).click(); await expect(page.getByText("sent: false · 외부 영향: NONE · 실제 이메일 발송 없음", { exact: true })).toBeVisible(); }
export function artifactPath(relativePath: string): string { return resolve(process.env.ACTFLOW_E2E_DIR!, relativePath); }
export async function verifyFiles(s: WorkflowSnapshot): Promise<void> {
  expect(s.artifacts).toHaveLength(2);
  for (const artifact of s.artifacts) {
    expect(artifact.state).toBe("COMMITTED"); expect(artifact.verificationStatus).toBe("VERIFIED");
    const path = artifactPath(artifact.relativePath); expect(existsSync(path)).toBe(true);
    const kind = artifact.displayName.endsWith("xlsx") ? "xlsx" : "docx";
    const result = await verifyArtifact({ path, kind, requiredTexts: kind === "xlsx" ? ["이름", "부서"] : ["AI 교육 참석 회신", "교육 운영팀"] });
    expect(result.passed).toBe(true); expect(result.sha256).toBe(artifact.sha256);
  }
}
