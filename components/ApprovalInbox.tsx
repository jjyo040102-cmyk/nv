"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Inbox } from "lucide-react";
import type { WorkflowSnapshot } from "@/lib/workflow/engine";
import type { ApprovalRecord } from "@/lib/db/repository";
import type { SessionActor } from "@/lib/domain/types";
import { apiRequest } from "./client";
import { ApprovalCard } from "./ApprovalCard";
export function ApprovalInbox() {
  const [snapshots, setSnapshots] = useState<WorkflowSnapshot[]>([]); const [actor, setActor] = useState<SessionActor>({ id: "demo-user", role: "USER", sessionId: "actflow-local-demo" }); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const refresh = useCallback(async () => { const [data, session] = await Promise.all([apiRequest<{ snapshots: WorkflowSnapshot[] }>("/api/approvals"), apiRequest<{ actor: SessionActor }>("/api/session/actor")]); setSnapshots(data.snapshots); setActor(session.actor); }, []);
  useEffect(() => { void refresh().catch(error => setError(error.message)); const changed = () => void refresh(); window.addEventListener("actflow-actor-changed", changed); return () => window.removeEventListener("actflow-actor-changed", changed); }, [refresh]);
  async function decide(approval: ApprovalRecord, decision: "APPROVED" | "REJECTED") { setBusy(true); setError(""); try { const session = await apiRequest<{ actor: SessionActor }>("/api/session/actor"); const body = { actor: session.actor.id, expectedVersion: approval.version }; await apiRequest(approval.kind === "CONFIRM" ? `/api/workflows/${approval.workflowId}/confirm` : `/api/approvals/${approval.id}/${decision === "APPROVED" ? "approve" : "reject"}`, approval.kind === "CONFIRM" ? { ...body, approvalId: approval.id, decision } : body); await refresh(); } catch (error) { setError((error as Error).message); await refresh(); } finally { setBusy(false); } }
  return <div><div className="page-heading"><div><p className="eyebrow">DECISION INBOX</p><h1>사람의 판단을 기다리는 업무</h1><p className="page-description">조건과 영향을 확인하고, 명시적으로 다음 단계를 결정하세요.</p></div><span className="badge status-waiting">{snapshots.length}개 대기</span></div>{error && <div role="alert" className="error-banner">{error}</div>}{snapshots.length ? snapshots.map(snapshot => <div key={snapshot.workflow.id} className="inbox-workflow"><Link href={`/workflows/${snapshot.workflow.id}`}>{snapshot.workflow.sourceName} →</Link>{snapshot.approvals.filter(approval => approval.status === "PENDING").map(approval => { const node = snapshot.nodes.find(node => node.id === approval.nodeId); return node ? <ApprovalCard key={approval.id} approval={approval} node={node} facts={snapshot.workflow.analysis?.facts ?? []} actor={actor} busy={busy || snapshot.workflow.status !== "WAITING"} onDecision={(a, d) => void decide(a, d)} /> : null; })}</div>) : <section className="panel empty-state"><Inbox size={34} /><strong>대기 중인 결정이 없습니다.</strong><p>워크플로의 확인·승인 요청이 이곳에 모입니다.</p></section>}</div>;
}
