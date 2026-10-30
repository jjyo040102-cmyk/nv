import { ZodError } from "zod";
import { DomainError, getDomainErrorKind } from "../domain/errors";
import type { WorkflowSnapshot } from "../workflow/engine";

export class ApiError extends DomainError {
  constructor(readonly status: number, message: string) { super("API", message); this.name = "ApiError"; }
}
export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}
export function publicSnapshot(snapshot: WorkflowSnapshot): WorkflowSnapshot {
  const { sourcePath: _path, ...workflow } = snapshot.workflow;
  return { ...snapshot, workflow: { ...workflow, sourcePath: null } };
}
export function apiFailure(error: unknown): Response {
  const kind = getDomainErrorKind(error);
  const apiStatus: unknown = kind === "API" && error instanceof Error ? Reflect.get(error, "status") : undefined;
  const status = kind === "API" && typeof apiStatus === "number" && Number.isInteger(apiStatus) && apiStatus >= 400 && apiStatus <= 599 ? apiStatus
    : kind === "WORKFLOW_CONFLICT" || kind === "TASK_CONFLICT" ? 409
    : kind === "AUTHORIZATION" || kind === "PROVIDER_PRIVACY" ? 403
    : kind === "DOCUMENT_PARSE" || kind === "MODEL_CONFIGURATION" || error instanceof ZodError ? 400
    : kind === "PROVIDER_CONNECTION" || kind === "PROVIDER_OUTPUT" ? 502 : 500;
  const message = status !== 500 && kind !== null && error instanceof Error ? error.message
    : status === 400 ? "요청 값이 올바르지 않습니다." : "요청을 처리하지 못했습니다.";
  return json({ error: { code: status, message } }, status);
}
