import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import type { AppConfig } from "../config";

export function openDatabase(config: AppConfig): Database.Database {
  if (config.dbPath !== ":memory:") mkdirSync(dirname(resolve(config.dbPath)), { recursive: true });
  const db = new Database(config.dbPath);
  db.pragma("foreign_keys = ON");
  if (config.dbPath !== ":memory:") db.pragma("journal_mode = WAL");
  return db;
}
