import type Database from 'better-sqlite3';
import { TaskConflictError } from './lease';

export type EpisodeContext = {
  workflow_id: string;
  living_task_id: string;
  owner_session_id: string;
  inbound_message_id: string | null;
  is_document_source: number;
  reply_status: 'NONE' | 'PENDING' | 'DISPATCHED' | 'FAILED';
  reply_workflow_id: string | null;
};

/** Persist only backend-derived bindings. No model field chooses a recipient, scope or identity. */
export function bindEpisodeContext(db: Database.Database, input: {
  workflowId: string; taskId: string; ownerSessionId: string; inboundMessageId?: string | null; isDocumentSource?: boolean;
}): EpisodeContext {
  const workflow = db.prepare('SELECT 1 FROM workflows w JOIN living_tasks t ON t.id=w.living_task_id AND t.owner_session_id=w.owner_session_id WHERE w.id=? AND w.living_task_id=? AND w.owner_session_id=?')
    .get(input.workflowId, input.taskId, input.ownerSessionId);
  if (!workflow) throw new TaskConflictError('실행과 작업의 소유 범위가 일치하지 않습니다.');
  if (input.inboundMessageId && !db.prepare("SELECT 1 FROM mail_messages WHERE message_id=? AND living_task_id=? AND owner_session_id=? AND direction='INBOUND'")
    .get(input.inboundMessageId, input.taskId, input.ownerSessionId)) throw new TaskConflictError('답장 대상 메일이 현재 작업에 없습니다.');
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO task_episode_context(workflow_id,living_task_id,owner_session_id,inbound_message_id,is_document_source,reply_status,created_at,updated_at)
    VALUES (?,?,?,?,?,'NONE',?,?)`).run(input.workflowId, input.taskId, input.ownerSessionId, input.inboundMessageId ?? null, Number(input.isDocumentSource ?? false), now, now);
  return getEpisodeContext(db, input.workflowId, input.ownerSessionId)!;
}

export function getEpisodeContext(db: Database.Database, workflowId: string, ownerSessionId: string): EpisodeContext | null {
  return db.prepare('SELECT * FROM task_episode_context WHERE workflow_id=? AND owner_session_id=?').get(workflowId, ownerSessionId) as EpisodeContext | undefined ?? null;
}
