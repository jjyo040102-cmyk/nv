"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, LoaderCircle } from "lucide-react";
import type { WorkflowSnapshot } from "@/lib/workflow/engine";
import type { ApprovalRecord } from "@/lib/db/repository";
import type { SessionActor } from "@/lib/domain/types";
import { apiRequest, type AppSettings } from "./client";
import { StatusBadge } from "./StatusBadge";
import { DocumentPanel } from "./DocumentPanel";
import { WorkflowGraph } from "./WorkflowGraph";
import { NodeInspector } from "./NodeInspector";
import { ExecutionControls } from "./ExecutionControls";
import { ApprovalCard } from "./ApprovalCard";
import { VerificationPanel } from "./VerificationPanel";
import { FlightRecorder } from "./FlightRecorder";
import { ConfirmDialog } from "./ConfirmDialog";
export function WorkflowWorkspace({ id }: { id: string }) {
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot | null>(null); const [settings, setSettings] = useState<AppSettings | null>(null);
  const [actor, setActor] = useState<SessionActor>({ id: "demo-user", role: "USER", sessionId: "actflow-local-demo" });
  const [selected, setSelected] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [discarding, setDiscarding] = useState(false);
  const refresh = useCallback(async () => { const [w, s, a] = await Promise.all([apiRequest<{ snapshot: WorkflowSnapshot }>(`/api/workflows/${id}`), apiRequest<{ settings: AppSettings }>("/api/settings"), apiRequest<{ actor: SessionActor }>("/api/session/actor")]); setSnapshot(w.snapshot); setSettings(s.settings); setActor(a.actor); }, [id]);
  useEffect(() => { void refresh().catch(error => setError(error.message)); const timer = window.setInterval(() => void refresh().catch(() => {}), 4000); const roleChanged = () => void refresh(); window.addEventListener("actflow-actor-changed", roleChanged); return () => { window.clearInterval(timer); window.removeEventListener("actflow-actor-changed", roleChanged); }; }, [refresh]);
  async function action(path: string, body?: unknown) {
    if (busy) return; setBusy(true); setError("");
    try { const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }); const data = await response.json(); if (data.snapshot) setSnapshot(data.snapshot); if (!response.ok) throw new Error(data.error?.message ?? data.snapshot?.workflow?.errorMessage ?? "요청을 처리하지 못했습니다."); }
    catch (error) { setError(error instanceof Error ? error.message : "요청에 실패했습니다."); await refresh().catch(() => {}); }
    finally { setBusy(false); }
  }
  async function decision(approval: ApprovalRecord, choice: "APPROVED" | "REJECTED") { try { const session = await apiRequest<{ actor: SessionActor }>("/api/session/actor"); const body = { actor: session.actor.id, expectedVersion: approval.version }; if (approval.kind === "CONFIRM") await action(`/api/workflows/${id}/confirm`, { ...body, approvalId: approval.id, decision: choice }); else await action(`/api/approvals/${approval.id}/${choice === "APPROVED" ? "approve" : "reject"}`, body); } catch (error) { setError((error as Error).message); } }
  if (!snapshot) return <div className="loading-state">{error ? <p role="alert">{error}</p> : <><LoaderCircle size={26} className="spin" />워크플로를 불러오는 중입니다.</>}</div>;
  const { workflow, nodes, artifacts, events } = snapshot; const pending = snapshot.approvals.find(approval => approval.status === "PENDING"); const gateNode = nodes.find(node => node.id === pending?.nodeId);
  const selectedNode = nodes.find(node => node.id === selected) ?? gateNode ?? nodes[0] ?? null; const executedActions = events.filter(event => event.eventType === "TOOL_EXECUTED").length;
  return <div className="workflow-workspace"><Link href="/" className="back-link"><ArrowLeft size={15} /> 모든 워크플로</Link><div className="page-heading workflow-heading"><div><p className="eyebrow">WORKFLOW · {id.slice(0, 8)}</p><h1><FileText size={25} />{workflow.sourceName}</h1><p className="page-description">{workflow.analysis?.summary ?? "원문을 읽었습니다. 문서 분석으로 다음 행동을 확인하세요."}</p></div><div className="heading-badges"><StatusBadge status={workflow.status} /><span className="badge neutral">{workflow.preExecutionEnabled ? "사전 실행 ON" : "수동 실행"}</span><span className="badge demo-badge">{workflow.provider?.mode === "real" ? workflow.provider.model : "데모 분석 모드"}</span></div></div>
    {(error || workflow.errorMessage) && <div role="alert" className="error-banner"><strong>{workflow.errorCode === "ROLLBACK_FAILED" ? "삭제 실패: 임시 파일이 남아 있습니다. " : ""}</strong>{error || workflow.errorMessage}</div>}
    {workflow.provider?.mode === "demo" && <div className="demo-mode-notice"><span className="online-dot" />데모 분석 모드 · 실제 LLM 호출 없음 · 외부 발송은 시뮬레이션입니다.</div>}
    <ExecutionControls status={workflow.status} busy={busy} hasTemporary={artifacts.some(a => ["TEMPORARY", "DELETE_FAILED"].includes(a.state))} executedActions={executedActions} onAnalyze={() => void action(`/api/workflows/${id}/analyze`, settings ? { executionMode: settings.executionMode, preExecutionEnabled: settings.preExecutionEnabled } : {})} onExecute={() => void action(`/api/workflows/${id}/execute`)} onPause={() => void action(`/api/workflows/${id}/pause`)} onResume={() => void action(`/api/workflows/${id}/resume`)} onDiscard={() => setDiscarding(true)} />
    {busy && <p className="busy-note" role="status"><LoaderCircle size={15} className="spin" /> 요청을 처리하고 실제 상태를 저장하고 있습니다.</p>}
    {pending && gateNode && workflow.status === "WAITING" && <ApprovalCard approval={pending} node={gateNode} facts={workflow.analysis?.facts ?? []} actor={actor} busy={busy} onDecision={decision} mailPreview={snapshot.mailPreview} />}
    {nodes.some(node => node.status === "BLOCKED") && <div className="human-only-notice"><strong>사람이 직접 검토해야 하는 작업입니다.</strong><p>등록되지 않았거나 사람이 수행해야 하는 작업의 자동 실행이 차단됐습니다.</p></div>}
    <div className="workflow-grid"><DocumentPanel sourceName={workflow.sourceName} sourceText={workflow.sourceText} facts={workflow.analysis?.facts ?? []} warnings={workflow.analysis?.warnings ?? []} /><WorkflowGraph nodes={nodes} edges={snapshot.edges} selected={selectedNode?.id ?? null} onSelect={setSelected} /><NodeInspector node={selectedNode} /></div>
    <div className="evidence-grid"><VerificationPanel artifacts={artifacts} events={events} /><FlightRecorder events={events} compact /></div>
    {discarding && <ConfirmDialog title="임시 작업을 폐기할까요?" description="임시 파일을 실제로 삭제합니다. 삭제 결과를 확인한 뒤 상태가 갱신되며, 실패한 파일은 근거와 함께 표시됩니다." confirmLabel="임시 파일 삭제" busy={busy} onCancel={() => setDiscarding(false)} onConfirm={() => { setDiscarding(false); void action(`/api/workflows/${id}/discard-temporary`); }} />}
  </div>;
}
