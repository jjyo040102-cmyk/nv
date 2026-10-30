import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { resolveDataScope } from '../security/data-scope';

export type ActivityRecord = { id: string; ownerSessionId: string; livingTaskId: string | null; eventType: string; details: Record<string, string | number | boolean | null>; createdAt: string };
/** Only callers' explicit identifiers/codes go here, never prompts, responses or secrets. */
export function recordActivity(db: Database.Database, ownerSessionId: string, livingTaskId: string | null, eventType: string, details: ActivityRecord['details'] = {}): void {
  resolveDataScope(db, { ownerSessionId, livingTaskId });
  db.prepare('INSERT INTO agent_activity(id,owner_session_id,living_task_id,event_type,details_json,created_at) VALUES (?,?,?,?,?,?)')
    .run(randomUUID(), ownerSessionId, livingTaskId, eventType, JSON.stringify(details), new Date().toISOString());
}
export function listActivity(db: Database.Database, ownerSessionId: string, livingTaskId: string): ActivityRecord[] {
  resolveDataScope(db, { ownerSessionId, livingTaskId });
  return (db.prepare('SELECT * FROM agent_activity WHERE owner_session_id=? AND living_task_id=? ORDER BY created_at,rowid').all(ownerSessionId, livingTaskId) as Array<{id:string;owner_session_id:string;living_task_id:string;event_type:string;details_json:string;created_at:string}>)
    .map(r => ({ id:r.id,ownerSessionId:r.owner_session_id,livingTaskId:r.living_task_id,eventType:r.event_type,details:JSON.parse(r.details_json),createdAt:r.created_at }));
}
