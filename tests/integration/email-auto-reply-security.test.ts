import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { openDatabase } from "../../lib/db";
import { runMigrations } from "../../lib/db/migrate";
import { WorkflowEngine } from "../../lib/workflow/engine";
import { TaskPlanner } from "../../lib/tasks/planner";
import { LivingTaskEngine } from "../../lib/tasks/engine";
import { EventRepository } from "../../lib/events/repository";
import { WakeEngine } from "../../lib/events/wake-engine";
import { EmailService } from "../../lib/email/service";
import { DemoMailTransport } from "../../lib/email/demo-transport";
import { VerifiedContactRepository } from "../../lib/email/verified-contacts";

const dbs: Database.Database[] = [], roots: string[] = [];
afterEach(() => { dbs.splice(0).forEach(db => db.close()); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
function setup() {
  const root = mkdtempSync(resolve(tmpdir(), "actflow-mail-sec-")); roots.push(root);
  const db = openDatabase({ dataDir: root, dbPath: ":memory:", demoAuth: true, maxUploadMb: 25 }); dbs.push(db); runMigrations(db);
  const workflow = new WorkflowEngine(db, root);
  const planner = new TaskPlanner(db, workflow, undefined, async () => async () => { throw new Error("planner should not run"); });
  const tasks = new LivingTaskEngine(db, workflow, planner); const events = new EventRepository(db); const wake = new WakeEngine(db, events); const transport = new DemoMailTransport();
  const service = new EmailService(db, tasks, events, wake, workflow, transport); const actor = { id: "u", sessionId: "a", role: "USER" as const };
  new VerifiedContactRepository(db).upsert({ ownerSessionId: "a", emailAddress: "User.Name@gmail.com", autoReplyEnabled: true });
  return { db, service, transport, actor };
}
const passAuth = { status: "PASS" as const, trustedAdapter: true, spf: "PASS" as const, dkim: "PASS" as const, dmarc: "PASS" as const };

describe("safe email auto reply", () => {
  it("auto sends only to the exact verified sender with trusted authentication", async () => {
    const { service, transport, actor } = setup();
    const received = await service.ingestTrusted({ from: "User.Name@gmail.com", messageId: "m1", threadId: "t", subject: "Question", body: "Can you reply?", auth: passAuth }, actor);
    const result = await service.reply(received.taskId, { subject: "Re: Question", body: "Done" }, actor);
    expect(result.status).toBe("SENT");
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.to).toBe("User.Name@gmail.com");
  });

  for (const [label, from, replyTo, auth] of [
    ["one-character mismatch", "User.Namf@gmail.com", undefined, passAuth],
    ["provider mismatch", "User.Name@naver.com", undefined, passAuth],
    ["plus alias", "User.Name+tag@gmail.com", undefined, passAuth],
    ["local-part case", "user.Name@gmail.com", undefined, passAuth],
    ["reply-to mismatch", "User.Name@gmail.com", "attacker@evil.test", passAuth],
    ["authentication failure", "User.Name@gmail.com", undefined, { ...passAuth, status: "FAIL" as const }]
  ] as const) {
    it(`waits for user approval on ${label}`, async () => {
      const { service, transport, actor } = setup();
      const received = await service.ingestTrusted({ from, replyTo, messageId: `m-${label}`, threadId: `t-${label}`, subject: "Question", body: "Reply", auth }, actor);
      const result = await service.reply(received.taskId, { subject: "Re", body: "Draft" }, actor);
      expect(result.status).toBe("WAITING_APPROVAL");
      expect(transport.sent).toHaveLength(0);
    });
  }

  it("never trusts authentication metadata supplied through the untrusted ingestion boundary", async () => {
    const { service, transport, actor } = setup();
    const received = await service.ingestUntrusted({ from: "User.Name@gmail.com", messageId: "untrusted", threadId: "u", subject: "Q", body: "B", auth: passAuth }, actor);
    expect(received.autoReplyEligible).toBe(false);
    const result = await service.reply(received.taskId, { subject: "Re", body: "Draft" }, actor);
    expect(result.status).toBe("WAITING_APPROVAL");
    expect(transport.sent).toHaveLength(0);
  });
});
