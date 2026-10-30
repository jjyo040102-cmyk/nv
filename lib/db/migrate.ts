import { readFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { DEFAULT_NVIDIA_MODEL } from "../providers/presets";

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return columns.some(item => item.name === column);
}
function addColumn(db: Database.Database, table: string, column: string, definition: string): void {
  if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function runMigrations(db: Database.Database): void {
 db.transaction(() => {
  // Legacy databases need columns added before the canonical CREATE INDEX statements can reference them.
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='wake_events'").get()) {
    addColumn(db,"wake_events","planning_retries","INTEGER NOT NULL DEFAULT 0 CHECK(planning_retries BETWEEN 0 AND 1)");
  }
  const hasWorkflows = Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workflows'").get());
  const hasSettings = Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").get());
  const hasMailMessages = Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mail_messages'").get());
  if (hasWorkflows) {
    addColumn(db, "workflows", "owner_session_id", "TEXT NOT NULL DEFAULT 'actflow-local-demo'");
    addColumn(db, "workflows", "living_task_id", "TEXT");
  }
  if (hasMailMessages) {
    addColumn(db, "mail_messages", "from_display_name", "TEXT");
    addColumn(db, "mail_messages", "reply_to_address", "TEXT");
  }
  if (hasSettings) {
    addColumn(db, "settings", "automation_profile", "TEXT NOT NULL DEFAULT 'SAFE'");
    addColumn(db, "settings", "auto_continue_enabled", "INTEGER NOT NULL DEFAULT 0");
    addColumn(db, "settings", "project_memory_enabled", "INTEGER NOT NULL DEFAULT 1");
    addColumn(db, "settings", "email_task_detection_enabled", "INTEGER NOT NULL DEFAULT 1");
    addColumn(db, "settings", "auto_link_work_enabled", "INTEGER NOT NULL DEFAULT 1");
    addColumn(db, "settings", "replan_on_new_info_enabled", "INTEGER NOT NULL DEFAULT 1");
    addColumn(db, "settings", "retry_failed_steps_enabled", "INTEGER NOT NULL DEFAULT 1");
    addColumn(db, "settings", "security_level", "TEXT NOT NULL DEFAULT 'HIGH'");
  }
  const sql = readFileSync(join(process.cwd(), "lib", "db", "schema.sql"), "utf8");
  // SQLite cannot alter CHECK constraints. Rebuild only configuration tables;
  // execution state, artifacts, and encrypted credential history remain intact.
  for (const table of ["settings", "encrypted_credentials", "agent_sessions"]) {
    const existing = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table) as { sql: string } | undefined;
    if (!existing?.sql.includes("'openai'")) continue;
    const definition = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\);`))?.[0];
    if (!definition) throw new Error("Missing canonical configuration table");
    db.exec(`ALTER TABLE ${table} RENAME TO ${table}_legacy_inference;`);
    db.exec(definition);
    const columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
    const names = columns.map(column => column.name);
    const values = names.map(name => table === "settings" && name === "provider_id" ? "'nebius'" :
      table === "settings" && name === "model" ? `'${DEFAULT_NVIDIA_MODEL}'` : table === "settings" && name === "effort" ? "NULL" : name);
    db.exec(`INSERT INTO ${table} (${names.join(",")}) SELECT ${values.join(",")} FROM ${table}_legacy_inference; DROP TABLE ${table}_legacy_inference;`);
  }
  db.exec(sql);
  if (hasColumn(db, "living_tasks", "model_mode_override")) db.exec("ALTER TABLE living_tasks DROP COLUMN model_mode_override");
  const preferences = db.prepare("SELECT owner_session_id,preferences_json FROM model_preferences").all() as Array<{ owner_session_id: string; preferences_json: string }>;
  for (const row of preferences) {
    let valid = false;
    try {
      const value = JSON.parse(row.preferences_json);
      valid = value.provider === "nebius" && /^nvidia\/[A-Za-z0-9][A-Za-z0-9._-]{2,139}$/.test(value.model) && value.effort === null &&
        Object.keys(value).every(key => ["provider", "model", "effort"].includes(key));
      // Explicit development fixtures remain fixtures across test restarts.
      if (process.env.ACTFLOW_TEST_MODE === "true" && process.env.NODE_ENV !== "production" && value.provider === "demo" && value.model === "actflow-demo-v1") valid = true;
    } catch { /* Invalid old configuration is replaced without any network call. */ }
    if (!valid) db.prepare("UPDATE model_preferences SET preferences_json=?,version=version+1,updated_at=? WHERE owner_session_id=?")
      .run(JSON.stringify({ provider: "nebius", model: DEFAULT_NVIDIA_MODEL, effort: null }), new Date().toISOString(), row.owner_session_id);
  }
  if (process.env.ACTFLOW_TEST_MODE !== "true" || process.env.NODE_ENV === "production") {
    db.prepare("UPDATE settings SET provider_id='nebius',model=?,effort=NULL WHERE provider_id='demo'").run(DEFAULT_NVIDIA_MODEL);
  }
 })();
}
