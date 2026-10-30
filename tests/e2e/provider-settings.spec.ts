import { test, expect } from "./fixtures";

test("Nebius configuration hides retired providers and keeps credentials masked", async ({ page, request }) => {
  await request.post("/api/settings", { data: { providerId: "nebius", model: "nvidia/nemotron-3-super-120b-a12b", effort: null } });
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Nebius × NVIDIA" })).toBeVisible();
  await expect(page.getByLabel("NVIDIA 분석 모델")).toHaveValue("nvidia/nemotron-3-super-120b-a12b");
  expect(await page.getByRole("button", { name: /OpenAI|Anthropic|Gemini|로컬 Qwen/ }).count()).toBe(0);
  await page.getByRole("button", { name: "연결 테스트", exact: true }).click();
  await expect(page.getByText("API 키를 먼저 저장하세요.", { exact: true })).toBeVisible();
  const raw = "synthetic-nebius-ui-test-key-6789";
  await page.getByLabel("API 키", { exact: true }).fill(raw);
  await page.getByRole("button", { name: "설정 저장", exact: true }).click();
  await expect(page.getByText(/저장됨 ••••6789/)).toBeVisible();
  expect(await page.getByLabel("API 키", { exact: true }).inputValue()).toBe("");
  expect(await (await request.get("/api/providers")).text()).not.toContain(raw);
  for (const provider of ["openai", "anthropic", "gemini"]) {
    expect((await request.post("/api/providers", { data: { providerId: provider, model: "legacy-model" } })).status()).toBe(400);
  }
  expect((await request.post("/api/models", { data: { settings: { mode: "LOCAL" } } })).status()).toBe(404);
  await page.getByRole("button", { name: /연결 해제/ }).click();
  await page.getByRole("button", { name: "키 삭제", exact: true }).click();
  await expect(page.getByText("저장된 키 없음", { exact: true })).toBeVisible();
});
