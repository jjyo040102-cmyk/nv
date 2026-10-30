import { test } from 'vitest';
import Database from 'better-sqlite3';
import { registerReleaseBoundaries } from '../support/release-boundary-cases';
registerReleaseBoundaries(test,filename=>{const db=new Database(filename??':memory:');db.pragma('foreign_keys = ON');return db;});
