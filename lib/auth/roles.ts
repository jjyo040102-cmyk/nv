import type { SessionActor } from "../domain/types";
import { DomainError } from "../domain/errors";

export class AuthorizationError extends DomainError {
  constructor(message = "권한이 없습니다.") { super("AUTHORIZATION", message); this.name = "AuthorizationError"; }
}

export function assertApprovalRole(actor: SessionActor): void {
  if (actor.role !== "APPROVER") throw new AuthorizationError("승인자 권한이 필요합니다.");
}

export function assertRequestActor(actor: SessionActor, claimed: unknown): void {
  if (!claimed || typeof claimed !== "object") throw new AuthorizationError("요청자 정보가 필요합니다.");
  const value = claimed as Record<string, unknown>;
  if (value.id !== actor.id || (value.role !== undefined && value.role !== actor.role) || (value.sessionId !== undefined && value.sessionId !== actor.sessionId)) {
    throw new AuthorizationError("요청자와 세션이 일치하지 않습니다.");
  }
}
