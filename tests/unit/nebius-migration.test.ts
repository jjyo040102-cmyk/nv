import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { runMigrations } from "../../lib/db/migrate";
import { WorkflowRepository } from "../../lib/db/repository";

it("replaces legacy inference choices while retaining tasks, execution settings, and encrypted history", () => {
  const db = new Database(":memory:");
  try {
    db.exec(readFileSync("tests/fixtures/release-candidate-schema.sql", "utf8"));
    db.exec("UPDATE settings SET execution_mode='PRE_EXECUTION',pre_execution_enabled=1,provider_id='openai',model='gpt-6-astra',organization_policy_version=4;");
    db.exec("INSERT INTO encrypted_credentials VALUES ('owner','openai','opaque-ciphertext','opaque-iv','opaque-tag','masked','then','then');");
    db.exec("INSERT INTO workflows(id,owner_session_id,source_name,status,execution_mode,created_at,updated_at) VALUES ('saved-workflow','owner','source.txt','DRAFT','MANUAL','then','then');");
    runMigrations(db);
    runMigrations(db);
    expect(new WorkflowRepository(db).getSettings()).toMatchObject({ providerId: "nebius", model: "nvidia/nemotron-3-super-120b-a12b", executionMode: "PRE_EXECUTION", preExecutionEnabled: true, organizationPolicyVersion: 4 });
    expect(db.prepare("SELECT source_name FROM workflows WHERE id='saved-workflow'").get()).toEqual({ source_name: "source.txt" });
    expect(db.prepare("SELECT ciphertext FROM encrypted_credentials WHERE provider='openai'").get()).toEqual({ ciphertext: "opaque-ciphertext" });
    expect(() => db.prepare("UPDATE settings SET provider_id='openai'").run()).toThrow();
  } finally { db.close(); }
});
