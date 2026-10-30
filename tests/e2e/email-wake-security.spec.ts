import { test, expect } from "./fixtures";

test("public email ingress never grants auto-reply trust from sender text alone", async ({ page }) => {
  const verified = await page.request.post("/api/verified-contacts", { data: { emailAddress: "Exact.User@gmail.com", autoReplyEnabled: true } });
  expect(verified.status()).toBe(201);

  for (const [from, messageId] of [
    ["Exact.User@gmail.com", "exact-but-untrusted"],
    ["Exact.Usfr@gmail.com", "lookalike"],
    ["Exact.User@naver.com", "provider-mismatch"],
    ["Exact.User+tag@gmail.com", "plus-alias"],
    ["exact.User@gmail.com", "local-case"]
  ] as const) {
    const response = await page.request.post("/api/events/email", { data: { from, messageId, threadId: messageId, subject: "Request", body: "Please handle this" } });
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.event.autoReplyEligible).toBe(false);
  }
});

test("reply-to text cannot be supplied as trusted identity through public ingress", async ({ page }) => {
  await page.request.post("/api/verified-contacts", { data: { emailAddress: "Exact.User@gmail.com", autoReplyEnabled: true } });
  const response = await page.request.post("/api/events/email", { data: { from: "Exact.User@gmail.com", replyTo: "attacker@example.net", messageId: "reply-to-attack", threadId: "attack", subject: "Request", body: "Reply here" } });
  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body.event.autoReplyEligible).toBe(false);
  expect(body.event.identityReasons).toContain("REPLY_TO_MISMATCH");
});
