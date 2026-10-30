import "../lib/config/load-env";
import { createHash } from "node:crypto";
import { readConfig } from "../lib/config";
import { openDatabase } from "../lib/db";
import { runMigrations } from "../lib/db/migrate";
import { WorkflowRepository } from "../lib/db/repository";
import { OFFICIAL_DEMO_TEXT } from "../lib/providers/demo";
const db = openDatabase(readConfig(process.env));
try {
  runMigrations(db); const repo = new WorkflowRepository(db), id = "04815252-c14c-4b7c-8836-3f72a5d7e001";
  if (!repo.getWorkflow(id)) repo.createWorkflow({ id, sourceName: "교육 안내문 · 공식 데모.txt", sourceMime: "text/plain", sourceText: OFFICIAL_DEMO_TEXT,
    sourceSha256: createHash("sha256").update(OFFICIAL_DEMO_TEXT).digest("hex"), executionMode: "MANUAL", preExecutionEnabled: false });
  console.log("Demo fixture ready. Seeding executes zero business actions and preserves existing workflows/settings.");
} finally { db.close(); }
