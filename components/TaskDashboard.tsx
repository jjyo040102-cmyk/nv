"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowUpRight, Check, CheckCheck, CircleAlert, Clock3, FileCheck2, FileText, FileUp, Layers3, LoaderCircle, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import type { LivingTaskRecord, LivingTaskStatus } from "@/lib/tasks/types";
import { apiRequest, formatTime, type AppSettings, type WorkflowListItem } from "./client";
import { StatusBadge } from "./StatusBadge";
import { GmailInbox } from "./GmailInbox";

type Props = { initialTasks?: LivingTaskRecord[]; initialWorkflows?: WorkflowListItem[]; initialSettings?: AppSettings };
type TaskFilter = "all" | "attention" | "active" | "waiting" | "completed";
const filters: { id: TaskFilter; label: string; statuses?: LivingTaskStatus[] }[] = [
  { id: "all", label: "전체" },
  { id: "attention", label: "확인 필요", statuses: ["WAITING_APPROVAL", "BLOCKED", "FAILED"] },
  { id: "active", label: "진행", statuses: ["DRAFT", "READY", "RUNNING"] },
  { id: "waiting", label: "대기", statuses: ["WAITING_EVENT", "PAUSED"] },
  { id: "completed", label: "완료", statuses: ["COMPLETED"] }
];
const attentionStatuses: LivingTaskStatus[] = ["WAITING_APPROVAL", "BLOCKED", "FAILED"];
const defaultNextAction: Record<LivingTaskStatus, string> = {
  DRAFT: "목표를 확인하고 실행을 시작하세요.", READY: "실행할 준비가 되었습니다.", RUNNING: "요청한 업무를 처리하고 있습니다.",
  WAITING_EVENT: "다음 소식을 기다리고 있습니다.", WAITING_APPROVAL: "내용을 검토하고 승인해 주세요.",
  PAUSED: "준비되면 이어서 실행할 수 있습니다.", COMPLETED: "결과와 완료 근거를 확인하세요.",
  FAILED: "문제를 확인한 뒤 다시 시도할 수 있습니다.", CANCELLED: "취소된 업무입니다. 기록을 확인할 수 있습니다.", BLOCKED: "계속하려면 추가 확인이 필요합니다."
};
const sampleGoal = "첨부된 교육 안내문을 검토해 참가자 명단과 회신 문서를 준비해줘. 출장비는 관리자 승인을 받고, 외부 발송 전에는 내 확인을 받아줘.";

export function TaskDashboard({ initialTasks, initialWorkflows }: Props) {
  const router = useRouter(), picker = useRef<HTMLInputElement>(null), goalInput = useRef<HTMLTextAreaElement>(null);
  const [tasks, setTasks] = useState(initialTasks ?? []), [workflows, setWorkflows] = useState(initialWorkflows ?? []);
  const [goal, setGoal] = useState(""), [file, setFile] = useState<File | null>(null);
  const [working, setBusy] = useState(false), [loadingSample, setLoadingSample] = useState(false), [sampleLoaded, setSampleLoaded] = useState(false);
  const [error, setError] = useState(""), [listError, setListError] = useState(""), [loading, setLoading] = useState(initialTasks === undefined);
  const [filter, setFilter] = useState<TaskFilter>("all"), [query, setQuery] = useState("");
  const [navigating, startNavigation] = useTransition();
  const busy = working || loadingSample || navigating;
  const attempt = useRef<{ signature: string; requestId: string } | null>(null);
  const inFlight = useRef(false), uploaded = useRef<{ file: File; id: string } | null>(null), mounted = useRef(true), refreshing = useRef(false);
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const [taskData, workflowData] = await Promise.all([apiRequest<{ tasks: LivingTaskRecord[] }>("/api/tasks"), apiRequest<{ workflows: WorkflowListItem[] }>("/api/workflows")]);
      if (mounted.current) { setTasks(taskData.tasks); setWorkflows(workflowData.workflows); setListError(""); }
    } catch (e) {
      if (mounted.current) setListError((e as Error).message);
    } finally {
      refreshing.current = false;
      if (mounted.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const update = () => { if (!document.hidden) void refresh(); };
    if (!initialTasks || !initialWorkflows) update();
    const timer = setInterval(update, 5000);
    window.addEventListener("focus", update);
    return () => { mounted.current = false; clearInterval(timer); window.removeEventListener("focus", update); };
  }, [refresh, initialTasks, initialWorkflows]);

  function selectFile(source: File | null) {
    setFile(source); uploaded.current = null; setSampleLoaded(false);
  }
  async function upload(source: File): Promise<string> {
    if (uploaded.current?.file === source) return uploaded.current.id;
    const form = new FormData(); form.set("file", source);
    const response = await fetch("/api/workflows", { method: "POST", body: form });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message ?? "문서를 업로드하지 못했습니다.");
    uploaded.current = { file: source, id: data.workflow.id as string };
    return data.workflow.id as string;
  }
  async function create() {
    if (busy || inFlight.current || (!goal.trim() && !file)) return;
    inFlight.current = true; setBusy(true); setError("");
    let createdTaskId: string | undefined;
    try {
      const sourceWorkflowId = file ? await upload(file) : undefined;
      const text = goal.trim() || `${file!.name} 문서를 검토하고 필요한 업무를 처리해줘.`;
      const signature = JSON.stringify({ text, sourceWorkflowId });
      if (attempt.current?.signature !== signature) attempt.current = { signature, requestId: crypto.randomUUID() };
      const response = await apiRequest<{ task: LivingTaskRecord }>("/api/tasks", { title: text.slice(0, 80), goal: text, sourceWorkflowId, requestId: attempt.current.requestId });
      createdTaskId = response.task.id;
      // Start authorizes planning and safe tools while preserving approval gates.
      if (["READY", "DRAFT", "FAILED"].includes(response.task.status)) await apiRequest(`/api/tasks/${createdTaskId}/execute`, {});
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (createdTaskId) startNavigation(() => router.push(`/tasks/${createdTaskId}`));
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function loadSample() {
    if (busy || inFlight.current) return;
    inFlight.current = true; setLoadingSample(true); setError("");
    try {
      const response = await fetch("/api/demo", { cache: "no-store" });
      if (!response.ok) throw new Error("예제 문서를 불러오지 못했습니다. 다시 시도해 주세요.");
      const source = new File([await response.text()], "training-notice.txt", { type: "text/plain" });
      if (mounted.current) {
        selectFile(source); setGoal(sampleGoal); setSampleLoaded(true);
        if (picker.current) picker.current.value = "";
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setLoadingSample(false);
        requestAnimationFrame(() => goalInput.current?.focus());
      }
    }
  }

  const attentionCount = tasks.filter(task => attentionStatuses.includes(task.status)).length;
  const selectedFilter = filters.find(item => item.id === filter)!;
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  const visibleTasks = tasks.filter(task => (!selectedFilter.statuses || selectedFilter.statuses.includes(task.status)) &&
    (!normalizedQuery || [task.title, task.goal, task.waitingReason, task.nextActionSummary].some(value => value?.toLocaleLowerCase("ko-KR").includes(normalizedQuery))))
    .sort((a, b) => Number(attentionStatuses.includes(b.status)) - Number(attentionStatuses.includes(a.status)) || b.updatedAt.localeCompare(a.updatedAt));
  const legacy = workflows.filter(workflow => !workflow.livingTaskId && !tasks.some(task => task.currentWorkflowId === workflow.id));

  return <div className="dashboard task-dashboard">
    <div className="page-heading dashboard-heading"><div><p className="eyebrow">YOUR WORK, MOVING FORWARD</p><h1>무엇을 맡길까요?</h1><p className="page-description">문서에서 실행까지. 맡긴 일의 다음 단계를 함께 이어갑니다.</p></div><span className="workspace-tag"><Layers3 size={15} aria-hidden="true" /> 나의 워크스페이스</span></div>
    <div className="dashboard-start-grid">
      <section className="goal-composer" aria-labelledby="composer-title" aria-busy={busy}>
        <div className="composer-heading"><span><Sparkles size={17} aria-hidden="true" /><h2 id="composer-title">새 업무 맡기기</h2></span><span className="composer-label">목표 + 필요한 문서</span></div>
        <textarea ref={goalInput} aria-label="새 업무 목표" aria-describedby="composer-help" value={goal} onChange={e => setGoal(e.target.value)} maxLength={20000} disabled={busy} placeholder="예: 교육 안내문을 검토하고 참가자 명단과 회신 문서를 준비해줘." />
        {file && <div className="attached-source" role="status"><FileText size={17} aria-hidden="true" /><span>{file.name}{sampleLoaded && <small>기본 제공 예제</small>}</span><button type="button" aria-label="첨부 취소" disabled={busy} onClick={() => { selectFile(null); if (picker.current) picker.current.value = ""; }}><X size={15} /></button></div>}
        {error && <div className="error-banner" role="alert">{error}</div>}
        <div className="composer-actions"><input ref={picker} aria-label="업무에 첨부할 파일" hidden type="file" accept=".txt,.pdf,.docx,.hwp,.png,.jpg,.jpeg,.tif,.tiff" disabled={busy} onChange={e => selectFile(e.target.files?.[0] ?? null)} /><button className="button composer-attach" onClick={() => picker.current?.click()} disabled={busy}><FileUp size={16} aria-hidden="true" /> 파일 첨부</button>
          <button className="button primary composer-start" onClick={() => void create()} disabled={busy || (!goal.trim() && !file)}>{working || navigating ? <><LoaderCircle className="spin" size={16} /> 작업을 준비하고 있습니다</> : <>시작 <ArrowRight size={16} aria-hidden="true" /></>}</button></div>
        <p id="composer-help" className="composer-help"><ShieldCheck size={14} aria-hidden="true" /> 승인과 확인이 필요한 단계는 실행 전에 멈춥니다.</p>
        {sampleLoaded && <p className="sample-loaded" role="status"><Check size={14} aria-hidden="true" /> 예제를 준비했어요. 목표를 확인하고 시작을 눌러주세요.</p>}
      </section>
      <aside className="sample-card" aria-labelledby="sample-title">
        <div className="sample-topline"><span className="sample-kicker">처음이라면</span><span className="sample-document-icon"><FileCheck2 size={22} aria-hidden="true" /></span></div>
        <h2 id="sample-title">문서 하나로,<br /> 완료까지 경험해 보세요.</h2>
        <p>교육 참가 안내문으로 명단 작성, 출장비 승인, 회신 준비를 살펴보세요.</p>
        <div className="sample-outputs"><span>XLSX 참가자 명단</span><span>DOCX 회신 문서</span></div>
        <button className="button sample-button" disabled={busy || sampleLoaded} onClick={() => void loadSample()}>{loadingSample ? <><LoaderCircle className="spin" size={16} /> 예제 불러오는 중</> : sampleLoaded ? <><Check size={16} /> 예제 준비 완료</> : <>{goal.trim() || file ? "입력 내용을 예제로 바꾸기" : "예제 문서로 시작"}<ArrowUpRight size={16} aria-hidden="true" /></>}</button>
        <small>기본 제공 예제 · 실행은 현재 모델 설정을 따릅니다.</small>
      </aside>
    </div>
    <div className="dashboard-shortcuts"><span className="shortcut-label">메일에서 이어가기</span><GmailInbox /><Link href="/settings" className="connector-link">모델·연결 설정 <ArrowUpRight size={13} aria-hidden="true" /></Link></div>
    <section className="panel recent-panel" aria-labelledby="tasks-heading">
      <div className="panel-heading"><div><h2 id="tasks-heading">내 작업 <span className="task-total">{tasks.length}</span></h2><p>확인이 필요한 일을 먼저, 나머지는 최근 활동 순으로 보여드려요.</p></div>{tasks.length > 0 && <label className="task-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="작업 검색" placeholder="작업 검색" value={query} onChange={e => setQuery(e.target.value)} /></label>}</div>
      {tasks.length > 0 && <><div className="task-filter-bar" role="group" aria-label="작업 상태 필터">{filters.map(item => {
        const count = item.statuses ? tasks.filter(task => item.statuses!.includes(task.status)).length : tasks.length;
        return <button key={item.id} type="button" className={`task-filter ${filter === item.id ? "selected" : ""}`} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label} <span>{count}</span></button>;
      })}</div>{attentionCount > 0 && filter === "all" && !normalizedQuery && <button type="button" className="attention-notice" onClick={() => setFilter("attention")}><CircleAlert size={16} aria-hidden="true" /><span><strong>{attentionCount}개 작업</strong>이 확인을 기다리고 있어요.</span><ArrowRight size={15} aria-hidden="true" /></button>}</>}
      {listError && <div className="list-error" role="alert"><span>{listError}</span><button type="button" className="button secondary" onClick={() => void refresh()}>다시 불러오기</button></div>}
      {loading ? <div className="dashboard-loading" role="status"><LoaderCircle size={21} className="spin" /> 작업을 불러오고 있습니다.</div> : visibleTasks.length ? <div className="task-card-list">{visibleTasks.map(task => {
        const attention = attentionStatuses.includes(task.status), Icon = attention ? CircleAlert : task.status === "COMPLETED" ? CheckCheck : ["WAITING_EVENT", "PAUSED"].includes(task.status) ? Clock3 : FileText;
        return <Link href={`/tasks/${task.id}`} className={`task-card ${attention ? "needs-attention" : ""}`} key={task.id}><div className="task-card-main"><span className="task-type-icon"><Icon size={18} aria-hidden="true" /></span><div><strong>{task.title}</strong><p>{task.goal}</p></div></div><div className="task-card-state"><StatusBadge status={task.status} /><small>{task.status === "COMPLETED" || task.status === "CANCELLED" ? defaultNextAction[task.status] : task.waitingReason ?? task.nextActionSummary ?? defaultNextAction[task.status]}</small></div><time dateTime={task.updatedAt}>{formatTime(task.updatedAt)}</time><ArrowUpRight className="task-open-icon" size={17} aria-hidden="true" /></Link>;
      })}</div> : tasks.length > 0 ? <div className="empty-state filtered-empty"><Search size={25} aria-hidden="true" /><strong>{normalizedQuery ? "검색한 작업을 찾지 못했어요." : `${selectedFilter.label} 상태의 작업이 없습니다.`}</strong><p>다른 검색어나 상태로 다시 찾아보세요.</p><button className="button secondary" onClick={() => { setQuery(""); setFilter("all"); }}>전체 작업 보기</button></div> : !listError && <div className="first-work-empty"><span className="empty-work-icon"><Layers3 size={25} aria-hidden="true" /></span><div><strong>첫 작업을 위한 공간이 준비됐어요.</strong><p>아직 시작한 작업이 없습니다. 목표를 입력하거나 위 예제 문서를 불러오세요.</p></div><button className="button secondary" onClick={() => goalInput.current?.focus()}>목표 입력하기 <ArrowUpRight size={15} aria-hidden="true" /></button></div>}
      {tasks.length > 0 && <div className="task-list-footer" aria-live="polite"><span>{visibleTasks.length}개 표시 · 전체 {tasks.length}개</span><span>상태는 자동으로 갱신됩니다</span></div>}
    </section>
    {legacy.length > 0 && <details className="panel legacy-section"><summary>이전 문서 작업 <span>{legacy.length}개</span></summary><div className="task-card-list">{legacy.slice(0, 20).map(workflow => <Link href={`/workflows/${workflow.id}`} className="task-card compact" key={workflow.id}><strong>{workflow.sourceName}</strong><StatusBadge status={workflow.status} /><ArrowUpRight size={16} aria-hidden="true" /></Link>)}</div></details>}
  </div>;
}
