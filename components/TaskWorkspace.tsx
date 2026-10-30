"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, Pause, Play, RefreshCw, RotateCcw, XCircle } from "lucide-react";
import type { ActivityRecord } from "@/lib/audit/activity";
import type { RecorderEvent } from "@/lib/audit/types";
import type { LivingTaskRecord, MemoryEntryRecord, ProjectRecord, TriggerSubscriptionRecord, WakeEventRecord } from "@/lib/tasks/types";
import { apiRequest, formatTime, type WorkflowListItem } from "./client";
import { StatusBadge } from "./StatusBadge";
import { TaskTimeline } from "./TaskTimeline";
import { TaskMemoryPanel } from "./TaskMemoryPanel";
import { TaskEmailReply } from "./TaskEmailReply";
import { TaskApproval } from "./TaskApproval";
import { GoalCompletion } from "./GoalCompletion";
import { EvidenceExport } from "./EvidenceExport";
import { TaskSchedule } from "./TaskSchedule";
import type { GoalContractView } from "@/lib/tasks/goal-contract";
import { ConfirmDialog } from "./ConfirmDialog";

type TaskArtifact = { id: string; workflowId: string; displayName: string; state: string; verificationStatus: string };
type Core = { task: LivingTaskRecord; project: ProjectRecord | null; workflows: WorkflowListItem[]; artifacts?: TaskArtifact[]; hasInboundEmail?: boolean;
  inboundSubject?:string|null;
  goalContract?: GoalContractView | null;
  latestReply?: { workflowId: string; status: string; externalEffect: "SIMULATED" | "ACTUAL" | null } | null };
type Detail = Core & { activity?: ActivityRecord[]; workflowEvents?: RecorderEvent[]; memory: MemoryEntryRecord[]; events: WakeEventRecord[]; triggers: TriggerSubscriptionRecord[] };

export function TaskWorkspace({ taskId, initial }: { taskId?: string; initial?: Detail }) {
  const router = useRouter(), id = taskId ?? initial?.task.id;
  const [data, setData] = useState<Detail | undefined>(initial), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [cancelling,setCancelling]=useState(false),[notice,setNotice]=useState("");
  const mounted = useRef(true), requestInFlight = useRef(false), loadSequence = useRef(0);
  const load = useCallback(async () => {
    if (!id) return;
    const sequence = ++loadSequence.current;
    const [core, memory, events, triggers] = await Promise.all([
      apiRequest<Core>(`/api/tasks/${id}`), apiRequest<{ memory: MemoryEntryRecord[] }>(`/api/tasks/${id}/memory`),
      apiRequest<{ events: WakeEventRecord[]; activity: ActivityRecord[]; workflowEvents: RecorderEvent[] }>(`/api/tasks/${id}/events`),
      apiRequest<{ triggers: TriggerSubscriptionRecord[] }>(`/api/tasks/${id}/triggers`)
    ]);
    if (mounted.current && sequence === loadSequence.current) setData({ ...core, memory: memory.memory, events: events.events, activity: events.activity, workflowEvents: events.workflowEvents, triggers: triggers.triggers });
  }, [id]);
  useEffect(() => {
    mounted.current = true;
    const update = () => { if (!document.hidden && !requestInFlight.current) void load().catch(e => { if (mounted.current) setError((e as Error).message); }); };
    if (!initial) update();
    const timer = setInterval(update, 4000); window.addEventListener("focus", update);
    return () => { mounted.current = false; ++loadSequence.current; clearInterval(timer); window.removeEventListener("focus", update); };
  }, [id, initial, load]);
  async function action(name: "plan" | "execute" | "pause" | "resume" | "cancel" | "wake") {
    if (!id || requestInFlight.current) return;
    requestInFlight.current = true; setBusy(true); setError("");
    try { await apiRequest(`/api/tasks/${id}/${name}`, {}, "POST"); router.refresh(); }
    catch (e) { if (mounted.current) setError((e as Error).message); }
    finally {
      // Even a rejected/failed action may have durable partial results. Always refresh them.
      await load().catch(e => { if (mounted.current) setError((e as Error).message); });
      requestInFlight.current = false; if (mounted.current) setBusy(false);
    }
  }
  async function reconcileMail() {
    if (busy || !id) return; setBusy(true); setError(""); setNotice("");
    try { const result=await apiRequest<{message:string}>(`/api/tasks/${id}/reconcile-mail`,{});setNotice(result.message);await load(); }
    catch(e){setError((e as Error).message);} finally{setBusy(false);}
  }
  async function disableTrigger(triggerId:string) {
    if (busy || !id) return;setBusy(true);setError("");
    try{await apiRequest(`/api/tasks/${id}/triggers`,{triggerId},"DELETE");await load();}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  if (!data) return <div className="loading-page" role={error ? "alert" : "status"}>{error || "작업을 불러오는 중입니다."}</div>;
  const { task } = data, terminal = ["COMPLETED","CANCELLED"].includes(task.status);
  const protectedState = ["PAUSED","BLOCKED","WAITING_APPROVAL","RUNNING"].includes(task.status);
  const current = data.workflows.find(workflow => workflow.id === task.currentWorkflowId);
  const needsReview = ["WAITING_APPROVAL","BLOCKED"].includes(task.status) && task.currentWorkflowId;
  return <div className="task-workspace">
    <Link href="/" className="back-link"><ArrowLeft size={15} /> 작업 목록</Link>
    <div className="page-heading task-heading"><div><p className="eyebrow">ONGOING WORK</p><h1>{task.title}</h1><p className="page-description">{task.goal}</p></div><div className="heading-badges"><StatusBadge status={task.status} />{task.backgroundWatchEnabled && <span className="badge demo-badge">자동 이어하기 ON</span>}</div></div>
    {error && <div role="alert" className="error-banner">{error}</div>}{notice&&<p role="status" className="info-banner">{notice}</p>}
    <div className="task-control-bar"><div><strong>{task.waitingReason ? "지금 기다리는 이유" : "다음 행동"}</strong><span>{task.waitingReason ?? task.nextActionSummary ?? "다음 계획을 준비할 수 있습니다."}</span></div><div className="control-buttons">
      {task.status === "PAUSED" ? <button className="button secondary" onClick={() => void action("resume")} disabled={busy}><Play size={15} /> 계속</button> : !terminal&&<button className="button secondary" onClick={() => void action("pause")} disabled={busy || task.status === "BLOCKED"}><Pause size={15} /> 일시정지</button>}
      {!terminal&&data.goalContract?.readyToComplete ? <Link className="button primary" href="#goal-completion">완료 조건 확인</Link> : needsReview ? <Link className="button primary" href={task.status==="WAITING_APPROVAL"?"#task-approval":`/workflows/${task.currentWorkflowId}`}>{task.status === "WAITING_APPROVAL" ? "승인 내용 확인" : "차단 이유 확인"}</Link> : !terminal&&<button className="button primary" onClick={() => void action("execute")} disabled={busy || terminal || protectedState}>{busy ? <RefreshCw className="spin" size={15} /> : <Play size={15} />} {task.status === "FAILED" ? "다시 시도" : task.currentWorkflowId ? "계속 진행" : "계획하고 실행"}</button>}
      {!terminal&&<details className="task-more-actions"><summary>더 보기</summary><div><button className="button secondary" onClick={() => void action("wake")} disabled={busy||protectedState}>지금 다시 확인</button><button className="button ghost-danger" onClick={() => setCancelling(true)} disabled={busy}>작업 취소</button></div></details>}
    </div></div>
    {(task.status === "PAUSED" || task.status === "CANCELLED") && current?.status === "RUNNING" && <p role="status" className="muted">다음 동작은 중지했습니다. 이미 시작된 동작의 결과는 확인 후 기록됩니다.</p>}
    
    {task.status==="WAITING_APPROVAL"&&task.currentWorkflowId&&<TaskApproval key={task.currentWorkflowId} workflowId={task.currentWorkflowId} onChanged={load}/>}
    {data.hasInboundEmail && <TaskEmailReply key={data.inboundSubject??task.id} taskId={task.id} inboundSubject={data.inboundSubject??undefined} onChanged={load} disabled={busy || terminal || protectedState} />}
    {data.latestReply && <section className="panel task-subpanel" aria-label="메일 처리 결과"><h3>메일 처리 결과</h3><p>{data.latestReply.status === "SENT" && data.latestReply.externalEffect === "SIMULATED" ? "모의 발송 결과가 검증됐습니다. 실제 이메일은 발송하지 않았습니다." : data.latestReply.status === "SENT" && data.latestReply.externalEffect === "ACTUAL" ? "메일 제공자의 발송 결과가 검증됐습니다." : data.latestReply.status === "UNKNOWN" || data.latestReply.status === "SENDING" ? "발송 결과 확인이 필요합니다. 자동 재발송하지 않습니다." : data.latestReply.status === "BLOCKED" ? "보안 정책에 따라 전송을 차단했습니다." : "답장이 준비되어 있습니다. 승인 및 실행 상태를 확인하세요."} <Link href={`/workflows/${data.latestReply.workflowId}`}>답장·승인·검증 보기</Link></p>{data.latestReply.status==="UNKNOWN"&&<button className="button secondary" disabled={busy} onClick={()=>void reconcileMail()}>Gmail 발송 결과 다시 확인</button>}</section>}
    {(data.artifacts?.length ?? 0) > 0 && <section className="panel task-subpanel"><div className="panel-heading"><div><h2>생성된 파일</h2><p>실제로 생성한 파일과 검증 결과입니다.</p></div></div><div className="task-card-list inside">{data.artifacts!.map(artifact => <div className="task-card compact" key={artifact.id}><strong>{artifact.displayName}</strong><span>{artifact.verificationStatus === "VERIFIED" && artifact.state === "COMMITTED" ? "검증 완료" : `${artifact.state} · ${artifact.verificationStatus}`}</span>{artifact.state === "COMMITTED" && artifact.verificationStatus === "VERIFIED" && <a className="button secondary" href={`/api/artifacts/${artifact.id}`}>파일 받기</a>}</div>)}</div></section>}
    {data.goalContract&&<GoalCompletion taskId={task.id} contract={data.goalContract} terminal={terminal} onChanged={load}/>}
    <EvidenceExport taskId={task.id}/>
    <details className="task-details"><summary>진행 내역과 다시 확인할 시간</summary><div className="task-overview-grid"><section className="panel task-summary-card"><h3>현재 상태</h3><dl><div><dt>프로젝트</dt><dd>{data.project?.name ?? "개별 작업"}</dd></div><div><dt>마지막 변경</dt><dd>{formatTime(task.updatedAt)}</dd></div><div><dt>자동 이어하기</dt><dd>{task.backgroundWatchEnabled ? "사용" : "사용 안 함"}</dd></div><div><dt>현재 워크플로</dt><dd>{task.currentWorkflowId ? <Link href={`/workflows/${task.currentWorkflowId}`}>열기 <ExternalLink size={12} /></Link> : "아직 없음"}</dd></div></dl></section>
      <section className="panel task-summary-card"><h3>자동 시작 조건</h3>{data.triggers.length ? <ul>{data.triggers.map(trigger => <li key={trigger.id}><strong>{trigger.type==='TIME'?'예약':trigger.type==='EMAIL'?'새 답장':trigger.type}</strong><span>{trigger.nextDueAt?formatTime(trigger.nextDueAt):trigger.enabled ? "사용 중" : "꺼짐"}</span>{trigger.enabled&&!terminal&&<button className="button secondary" disabled={busy} onClick={()=>void disableTrigger(trigger.id)}>끄기</button>}</li>)}</ul> : <p className="muted">필요한 시간에 이 작업을 다시 확인하도록 예약할 수 있습니다.</p>}{!terminal&&<TaskSchedule taskId={task.id} onChanged={load}/>}</section></div>
      <div className="task-detail-grid"><TaskTimeline events={data.events} activity={data.activity} workflowEvents={data.workflowEvents} /><TaskMemoryPanel memory={data.memory} /></div>
      <section className="panel task-subpanel"><div className="panel-heading"><div><h2>워크플로 기록</h2><p>이 작업에서 계획하거나 실행한 각 단계입니다.</p></div></div>{data.workflows.length ? <div className="task-card-list inside">{data.workflows.map(workflow => <Link className="task-card compact" href={`/workflows/${workflow.id}`} key={workflow.id}><strong>{workflow.sourceName}</strong><StatusBadge status={workflow.status} /><ExternalLink size={15} /></Link>)}</div> : <div className="empty-inline padded">아직 생성된 워크플로가 없습니다.</div>}</section>
    </details>
    {cancelling&&<ConfirmDialog title="작업을 취소할까요?" description="다음 실행을 중지합니다. 이미 실행된 결과와 기록은 확인할 수 있습니다." confirmLabel="작업 취소" busy={busy} onCancel={()=>setCancelling(false)} onConfirm={()=>{setCancelling(false);void action("cancel");}}/>}
  </div>;
}
