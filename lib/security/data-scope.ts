import type Database from 'better-sqlite3';
import { AuthorizationError } from '../auth/roles';

/** Ownership is checked before relevance, memory writes or artifact selection. */
export function resolveDataScope(db: Database.Database, input: {
  ownerSessionId: string; projectId?: string | null; livingTaskId?: string | null;
}): { projectId: string | null; livingTaskId: string | null } {
  if (!input.ownerSessionId) throw new AuthorizationError();
  let projectId = input.projectId ?? null;
  if (input.livingTaskId) {
    const task = db.prepare('SELECT project_id FROM living_tasks WHERE id=? AND owner_session_id=?')
      .get(input.livingTaskId, input.ownerSessionId) as { project_id: string | null } | undefined;
    if (!task || (input.projectId !== undefined && task.project_id !== input.projectId)) throw new AuthorizationError('작업 또는 프로젝트 범위가 일치하지 않습니다.');
    projectId = task.project_id;
  }
  if (projectId && !db.prepare('SELECT 1 FROM projects WHERE id=? AND owner_session_id=?').get(projectId, input.ownerSessionId)) throw new AuthorizationError();
  return { projectId, livingTaskId: input.livingTaskId ?? null };
}
