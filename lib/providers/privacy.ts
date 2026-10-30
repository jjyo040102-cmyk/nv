import { scanSecrets } from "../security/secret-scanner";
import { ProviderPrivacyError } from "./errors";
import type { AnalyzeDocumentRequest } from "./prompts";

export function assertSafeCloudInput(text: string): void {
  if (scanSecrets(text).length) throw new ProviderPrivacyError();
  // Task envelopes escape the original document strings. Check decoded fields too.
  if (!/^[\s]*[\[{\"]/.test(text)) return;
  if (text.length > 2_000_000) throw new ProviderPrivacyError("자료가 너무 커 전송 전 비밀 값 검사를 완료하지 못했습니다.");
  let decoded: unknown;
  try { decoded = JSON.parse(text); } catch { return; }
  const pending: unknown[] = [decoded];
  let checked = 0;
  while (pending.length) {
    if (++checked > 10_000) throw new ProviderPrivacyError("자료의 구조가 너무 복잡해 전송 전 비밀 값 검사를 완료하지 못했습니다.");
    const value = pending.pop();
    if (typeof value === "string") {
      if (scanSecrets(value).length) throw new ProviderPrivacyError();
    } else if (value && typeof value === "object") {
      const values = Object.values(value);
      if (pending.length + values.length > 10_000) throw new ProviderPrivacyError("자료의 구조가 너무 복잡해 전송 전 비밀 값 검사를 완료하지 못했습니다.");
      pending.push(...values);
    }
  }
}

export function assertSafeCloudRequest(request: AnalyzeDocumentRequest): void {
  for (const text of [request.text, request.sourceName, request.locale ?? "ko"]) assertSafeCloudInput(text);
}
