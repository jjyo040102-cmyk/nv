import { ApiError } from "../api/responses";
export type GoogleRequest = <T>(url: string, init?: RequestInit, maxBytes?: number) => Promise<T>;
export const googleRequest: GoogleRequest = async <T>(url: string, init: RequestInit = {}, maxBytes = 3 * 1024 * 1024): Promise<T> => {
  const target = new URL(url);
  if (target.protocol !== "https:" || !["oauth2.googleapis.com", "gmail.googleapis.com"].includes(target.hostname) || target.port || target.username || target.password) throw new Error("Unsupported Google endpoint");
  let response: Response;
  try { response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(25_000), cache: "no-store" }); }
  catch { throw new ApiError(502, "Gmail 연결에 실패했습니다. 연결 상태를 확인하세요."); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ApiError(response.status === 401 || response.status === 403 ? 409 : 502,
      response.status === 401 || response.status === 403 ? "Gmail 권한이 만료됐거나 부족합니다. 설정에서 다시 연결하세요." : "Gmail 요청이 실패했습니다. 잠시 뒤 연결 상태를 확인하세요.");
  }
  const reader = response.body?.getReader(); if (!reader) throw new ApiError(502, "Gmail 응답이 비어 있습니다.");
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > maxBytes) throw new ApiError(413, "Gmail 응답이 허용 크기를 초과했습니다."); chunks.push(part.value); } }
  finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T; }
  catch { throw new ApiError(502, "Gmail 응답을 읽지 못했습니다."); }
};
