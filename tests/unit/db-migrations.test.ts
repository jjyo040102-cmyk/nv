import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../lib/db";
import { runMigrations } from "../../lib/db/migrate";
import { WorkflowRepository } from "../../lib/db/repository";

const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function memoryDb() {
  const db = openDatabase({ dataDir: ".", dbPath: ":memory:", demoAuth: true, maxUploadMb: 25 });
  databases.push(db);
  return db;
}

describe("SQLite migrations", () => {
  it("runs twice and initializes conservative execution settings", () => {
    const db = memoryDb();
    runMigrations(db);
    runMigrations(db);
    expect(new WorkflowRepository(db).getSettings()).toMatchObject({ executionMode: "MANUAL", preExecutionEnabled: false });
    expect(db.prepare("SELECT count(*) AS count FROM settings").get()).toMatchObject({ count: 1 });
  });

  it("rejects invalid workflow states through SQL constraints", () => {
    const db = memoryDb();
    runMigrations(db);
    expect(() => db.prepare("INSERT INTO workflows(id, source_name, status, execution_mode, created_at, updated_at) VALUES ('x','x','MAGIC','MANUAL','now','now')").run()).toThrow();
  });

  it("stores credentials only in encrypted columns", () => {
    const db = memoryDb();
    runMigrations(db);
    const columns = db.prepare("PRAGMA table_info(encrypted_credentials)").all() as Array<{ name: string }>;
    expect(columns.map(column => column.name)).toEqual(["session_id", "provider", "ciphertext", "iv", "tag", "masked_hint", "created_at", "updated_at"]);
  });
});

it("preserves legacy workflow data while adding persistent-agent tables and linkage", () => {
  const db = memoryDb();
  db.exec(`CREATE TABLE workflows (
    id TEXT PRIMARY KEY,
    owner_session_id TEXT NOT NULL DEFAULT 'actflow-local-demo',
    source_name TEXT NOT NULL,
    source_mime TEXT, source_sha256 TEXT, source_path TEXT, source_text TEXT,
    status TEXT NOT NULL, execution_mode TEXT NOT NULL, pre_execution_enabled INTEGER NOT NULL DEFAULT 0,
    analysis_json TEXT, provider_json TEXT, error_code TEXT, error_message TEXT,
    version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );`);
  db.prepare("INSERT INTO workflows(id,owner_session_id,source_name,status,execution_mode,pre_execution_enabled,version,created_at,updated_at) VALUES ('legacy','owner-a','legacy.txt','DRAFT','MANUAL',0,0,'now','now')").run();
  runMigrations(db);
  expect(db.prepare("SELECT id, source_name FROM workflows WHERE id='legacy'").get()).toEqual({ id: "legacy", source_name: "legacy.txt" });
  const tableNames = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{name:string}>).map(row => row.name);
  for (const name of ["projects","living_tasks","memory_entries","agent_sessions","trigger_subscriptions","wake_events","verified_contacts","task_evidence"]) expect(tableNames).toContain(name);
  const workflowColumns = db.prepare("PRAGMA table_info(workflows)").all() as Array<{name:string}>;
  expect(workflowColumns.map(column => column.name)).toContain("living_task_id");
});
