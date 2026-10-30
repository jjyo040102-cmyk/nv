import { resolve } from "node:path";
import { test, expect } from "./fixtures";

test("a goal with its document survives browser closure and Wake preserves a pending approval", async ({ page, request }) => {
  await page.goto("/");
  await page.getByLabel("새 업무 목표").fill("교육 대상자 명단과 회신 자료를 준비해줘.");
  await page.getByLabel("업무에 첨부할 파일").setInputFiles(resolve("data/demo/training-notice.txt"));
  await page.getByRole("button", { name: "시작", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").at(-1)!;
  await expect.poll(async () => (await (await request.get(`/api/tasks/${id}`)).json()).task.status).toBe("WAITING_APPROVAL");
  const before = (await (await request.get(`/api/tasks/${id}`)).json()).task;
  const context = page.context();
  await page.close();
  const wake = await request.post(`/api/tasks/${id}/wake`, { data: {} });
  expect(wake.ok()).toBe(true);
  const after = (await (await request.get(`/api/tasks/${id}`)).json()).task;
  expect(after.status).toBe("WAITING_APPROVAL");
  expect(after.currentWorkflowId).toBe(before.currentWorkflowId);
  expect(after.goal).toBe("교육 대상자 명단과 회신 자료를 준비해줘.");
  const reopened = await context.newPage();
  await reopened.goto(`/tasks/${id}`);
  await expect(reopened.getByText("교육 대상자 명단과 회신 자료를 준비해줘.", { exact: true }).first()).toBeVisible();
  await expect(reopened.getByText("승인 대기", { exact: true }).first()).toBeVisible();
  await expect(reopened.getByRole("link", { name: "승인 내용 확인" })).toBeVisible();
});
