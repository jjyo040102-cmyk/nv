import type { ProviderId } from "../domain/types";
import { DomainError, getDomainErrorKind, type DomainErrorKind } from "../domain/errors";

export class ProviderError extends DomainError {
  constructor(readonly provider: ProviderId, readonly code: string, readonly safeMessage: string, readonly retryable: boolean, kind: DomainErrorKind = "PROVIDER") {
    super(kind, safeMessage);
    this.name = "ProviderError";
  }
  toJSON() { return { name: this.name, provider: this.provider, code: this.code, safeMessage: this.safeMessage, retryable: this.retryable }; }
}
export class ProviderOutputError extends ProviderError {
  constructor(provider: ProviderId) { super(provider, "INVALID_OUTPUT", "분석 결과 형식이 올바르지 않습니다. 다시 시도해 주세요.", true, "PROVIDER_OUTPUT"); this.name = "ProviderOutputError"; }
}
export class ProviderConnectionError extends ProviderError {
  constructor(provider: ProviderId, safeMessage = "제공자 연결에 실패했습니다. 키와 네트워크를 확인해 주세요.") {
    super(provider, "CONNECTION_FAILED", safeMessage, true, "PROVIDER_CONNECTION"); this.name = "ProviderConnectionError";
  }
}

export class ProviderPrivacyError extends ProviderError {
  constructor(safeMessage = "Nebius로 전송할 자료에서 자격 증명 패턴을 발견했습니다. 비밀 값을 제거한 뒤 다시 시도하세요."){super("nebius","PRIVACY_BLOCKED",safeMessage,false,"PROVIDER_PRIVACY");this.name="ProviderPrivacyError";}
}

export function isProviderError(error: unknown): error is ProviderError {
  const kind = getDomainErrorKind(error);
  return kind !== null && kind.startsWith("PROVIDER") && error instanceof Error &&
    typeof Reflect.get(error, "code") === "string" && typeof Reflect.get(error, "safeMessage") === "string" &&
    typeof Reflect.get(error, "retryable") === "boolean" && ["demo", "nebius"].includes(Reflect.get(error, "provider"));
}
