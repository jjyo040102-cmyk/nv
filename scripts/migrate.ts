import "../lib/config/load-env";
import { readConfig } from "../lib/config";
import { openDatabase } from "../lib/db";
import { runMigrations } from "../lib/db/migrate";
const db = openDatabase(readConfig(process.env));
try { runMigrations(db); console.log("ActFlow database migrations complete (idempotent)."); }
finally { db.close(); }
