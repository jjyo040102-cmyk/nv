import type { SessionActor } from "../domain/types";
import type { ApiRuntime } from "./runtime";
import { ApiError } from "./responses";
export function assertWorkflowAccess(app: ApiRuntime, workflowId: string, actor: SessionActor): void {
  const row = app.db.prepare("SELECT owner_session_id FROM workflows WHERE id=?").get(workflowId) as { owner_session_id: string } | undefined;
  if (!row) throw new ApiError(404, "워크플로를 찾을 수 없습니다.");
  if (row.owner_session_id !== actor.sessionId) throw new ApiError(403, "워크플로 접근 권한이 없습니다.");
}
