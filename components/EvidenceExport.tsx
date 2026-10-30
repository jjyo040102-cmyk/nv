"use client";
import { useRef, useState } from "react";
import { Download, LoaderCircle } from "lucide-react";

export function EvidenceExport({ taskId }: { taskId: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const inFlight = useRef(false);
  async function download() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/evidence`, { cache: "no-store" });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error?.message ?? "검증 요약을 저장하지 못했습니다.");
      }
      const url = URL.createObjectURL(await response.blob()), anchor = document.createElement("a");
      anchor.href = url; anchor.download = "actflow-evidence.json"; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setError(error instanceof Error ? error.message : "검증 요약을 저장하지 못했습니다."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="evidence-export">
    <button className="button secondary" disabled={busy} onClick={() => void download()}>{busy ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}{busy ? "파일 무결성 확인 중…" : "검증 요약 저장"}</button>
    <p className="muted">완료 조건·실행 기록·파일 해시를 JSON으로 저장합니다. 목표 본문, 메일 주소와 파일명은 포함하지 않습니다.</p>
    {error && <p className="error-banner" role="alert">{error}</p>}
  </div>;
}
