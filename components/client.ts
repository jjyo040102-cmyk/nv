import type { AppSettings } from "@/lib/db/settings-repository";
import type { WorkflowStatus } from "@/lib/domain/types";
export type WorkflowListItem = { id: string; livingTaskId?: string | null; sourceName: string; status: WorkflowStatus; pendingKind?: "CONFIRM" | "APPROVAL" | null; executionMode: string; preExecutionEnabled: boolean | number; provider: string | null; createdAt: string; updatedAt: string };
export type { AppSettings };
export async function apiRequest<T>(url: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  const response = await fetch(url, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new Error("서버 응답을 읽지 못했습니다. 연결 상태와 실행 기록을 확인하세요. 같은 작업을 중복 생성하지 마세요."); }
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/login") window.location.assign("/login");
    const result = data && typeof data === "object" ? data as { error?: { message?: unknown }; snapshot?: { workflow?: { errorMessage?: unknown } } } : {};
    const message = result.error?.message ?? result.snapshot?.workflow?.errorMessage;
    throw new Error(typeof message === "string" ? message : "요청을 처리하지 못했습니다.");
  }
  return data as T;
}
export function formatTime(value: string): string { return new Date(value).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
export function formatBytes(bytes: number): string { return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`; }
