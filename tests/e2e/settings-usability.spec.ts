import { test, expect } from "./fixtures";

test("recommended automation is simple while important external actions remain controlled", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByText("자동으로 처리 (추천)", { exact: true })).toBeVisible();
  await expect(page.getByText("자동 이어하기", { exact: false }).first()).toBeVisible();
  await page.getByText('세부 실행 규칙과 기록',{exact:true}).click();
  await expect(page.getByText(/확인 후 실행 \(추천\)/)).toBeVisible();
  await expect(page.getByText(/주소가 한 글자라도 다르면/)).toBeVisible();

  await page.getByLabel("인증할 이메일 주소").fill("trusted@example.com");
  await page.getByRole("button", { name: "주소 추가" }).click();
  await expect(page.getByText("trusted@example.com", { exact: true })).toBeVisible();
});
