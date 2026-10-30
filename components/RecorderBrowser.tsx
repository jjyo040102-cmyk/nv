"use client";
import { useEffect, useState } from "react";
import type { RecorderEvent } from "@/lib/audit/types";
import { apiRequest, type WorkflowListItem } from "./client";
import { FlightRecorder } from "./FlightRecorder";
export function RecorderBrowser() {
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([]); const [id, setId] = useState(""); const [events, setEvents] = useState<RecorderEvent[]>([]); const [error, setError] = useState("");
  useEffect(() => { apiRequest<{ workflows: WorkflowListItem[] }>("/api/workflows").then(data => { setWorkflows(data.workflows); setId(data.workflows[0]?.id ?? ""); }).catch(error => setError(error.message)); }, []);
  useEffect(() => { if (id) apiRequest<{ events: RecorderEvent[] }>(`/api/workflows/${id}/events`).then(data => setEvents(data.events)).catch(error => setError(error.message)); }, [id]);
  return <div><div className="page-heading"><div><p className="eyebrow">FLIGHT RECORDER</p><h1>실행의 모든 판단과 근거</h1><p className="page-description">수행한 일과 대기한 이유, 검증과 폐기 결과를 그대로 확인하세요.</p></div></div>{error && <div role="alert" className="error-banner">{error}</div>}<div className="recorder-select field"><label htmlFor="recorder-workflow">워크플로 선택</label><select id="recorder-workflow" value={id} onChange={event => setId(event.target.value)}>{workflows.length ? workflows.map(workflow => <option value={workflow.id} key={workflow.id}>{workflow.sourceName} · {workflow.id.slice(0, 8)}</option>) : <option value="">저장된 워크플로 없음</option>}</select></div><FlightRecorder events={events} /></div>;
}
