import { it } from 'vitest';
import Database from 'better-sqlite3';
import { registerStabilizationCases } from '../support/stabilization-cases';
registerStabilizationCases(it, path => {
  const db = new Database(path ?? ':memory:');
  db.pragma('foreign_keys = ON');
  return db;
});
