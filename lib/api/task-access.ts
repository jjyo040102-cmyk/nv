import type Database from "better-sqlite3";
import { AuthorizationError } from "../auth/roles";
import type { SessionActor } from "../domain/types";

export function assertProjectAccess(db: Database.Database, projectId: string, actor: SessionActor): void {
  const row = db.prepare("SELECT owner_session_id FROM projects WHERE id=?").get(projectId) as { owner_session_id:string } | undefined;
  if (!row || row.owner_session_id !== actor.sessionId) throw new AuthorizationError("이 프로젝트에 접근할 수 없습니다.");
}

export function assertTaskAccess(db: Database.Database, taskId: string, actor: SessionActor): void {
  const row = db.prepare("SELECT owner_session_id FROM living_tasks WHERE id=?").get(taskId) as { owner_session_id:string } | undefined;
  if (!row || row.owner_session_id !== actor.sessionId) throw new AuthorizationError("이 작업에 접근할 수 없습니다.");
}
