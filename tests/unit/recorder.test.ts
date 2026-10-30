import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../lib/db";
import { runMigrations } from "../../lib/db/migrate";
import { WorkflowRepository } from "../../lib/db/repository";
import { FlightRecorder } from "../../lib/audit/recorder";

const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

describe("append-only flight recorder", () => {
  it("keeps ordered provider, policy, action and non-action evidence and blocks SQL edits", () => {
    const db = openDatabase({ dataDir: ".", dbPath: ":memory:", demoAuth: true, maxUploadMb: 25 });
    databases.push(db);
    runMigrations(db);
    const workflow = new WorkflowRepository(db).createWorkflow({ sourceName: "notice.txt" });
    const recorder = new FlightRecorder(db);
    recorder.appendRecorderEvent({ workflowId: workflow.id, eventType: "ANALYZED", actor: "demo-user", provider: "demo", model: "actflow-demo-v1", providerMode: "demo", realModelCalled: false, externalEffect: "NONE", details: { executedActions: 0 } });
    recorder.appendRecorderEvent({ workflowId: workflow.id, eventType: "POLICY_DECISION", actor: "system", action: "expense.process", policyClass: "APPROVAL", policyVersion: 1, matchedRules: ["builtin.expense-threshold"], externalEffect: "NONE" });
    const events = recorder.listRecorderEvents(workflow.id);
    expect(events.map(event => event.eventType)).toEqual(["ANALYZED", "POLICY_DECISION"]);
    expect(events[0]).toMatchObject({ provider: "demo", realModelCalled: false, details: { executedActions: 0 } });
    expect(events[1]).toMatchObject({ action: "expense.process", policyClass: "APPROVAL" });
    expect(() => db.prepare("UPDATE recorder_events SET event_type='LIE' WHERE id=?").run(events[0].id)).toThrow();
    expect(() => db.prepare("DELETE FROM recorder_events WHERE id=?").run(events[0].id)).toThrow();
  });
});
