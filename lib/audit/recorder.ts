import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { NewRecorderEvent, RecorderEvent } from "./types";

export class FlightRecorder {
  constructor(private readonly db: Database.Database) {}

  appendRecorderEvent(event: NewRecorderEvent): RecorderEvent {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const result = this.db.prepare("INSERT INTO recorder_events(id,workflow_id,node_id,event_type,event_json,created_at) VALUES (?,?,?,?,?,?)")
      .run(id, event.workflowId, event.nodeId ?? null, event.eventType, JSON.stringify(event), createdAt);
    return { ...event, id, sequence: Number(result.lastInsertRowid), createdAt };
  }

  listRecorderEvents(workflowId: string): RecorderEvent[] {
    const rows = this.db.prepare("SELECT sequence,id,event_json,created_at FROM recorder_events WHERE workflow_id=? ORDER BY sequence").all(workflowId) as Array<{ sequence: number; id: string; event_json: string; created_at: string }>;
    return rows.map(row => ({ ...(JSON.parse(row.event_json) as NewRecorderEvent), id: row.id, sequence: row.sequence, createdAt: row.created_at }));
  }

  listTaskEvents(livingTaskId: string, ownerSessionId: string): RecorderEvent[] {
    const owner = this.db.prepare("SELECT 1 FROM living_tasks WHERE id=? AND owner_session_id=?").get(livingTaskId, ownerSessionId);
    if (!owner) return [];
    const rows = this.db.prepare(`SELECT r.sequence,r.id,r.event_json,r.created_at
      FROM recorder_events r JOIN workflows w ON w.id=r.workflow_id
      WHERE w.living_task_id=? AND w.owner_session_id=? ORDER BY r.sequence`).all(livingTaskId, ownerSessionId) as Array<{ sequence:number; id:string; event_json:string; created_at:string }>;
    return rows.map(row => ({ ...(JSON.parse(row.event_json) as NewRecorderEvent), id: row.id, sequence: row.sequence, createdAt: row.created_at }));
  }
}
