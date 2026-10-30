"use client";
import { useCallback, useEffect, useState } from "react";
import type { WorkflowSnapshot } from "@/lib/workflow/engine";
import type { SessionActor } from "@/lib/domain/types";
import { ApprovalCard } from "./ApprovalCard";
import { apiRequest } from "./client";
export function TaskApproval({ workflowId, onChanged }: { workflowId: string; onChanged: () => Promise<void> }) {
  const [snapshot,setSnapshot]=useState<WorkflowSnapshot|null>(null),[actor,setActor]=useState<SessionActor|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const load=useCallback(async()=>{const [work,session]=await Promise.all([apiRequest<{snapshot:WorkflowSnapshot}>(`/api/workflows/${workflowId}`),apiRequest<{actor:SessionActor}>("/api/session/actor")]);setSnapshot(work.snapshot);setActor(session.actor);},[workflowId]);
  useEffect(()=>{let active=true;const listener=()=>{if(active&&!document.hidden)void load().catch(e=>{if(active)setError(e.message);});};listener();const timer=setInterval(listener,4000);window.addEventListener("actflow-actor-changed",listener);return()=>{active=false;clearInterval(timer);window.removeEventListener("actflow-actor-changed",listener);};},[load]);
  const pending=snapshot?.approvals.find(item=>item.status==="PENDING"),node=snapshot?.nodes.find(item=>item.id===pending?.nodeId);
  return <div id="task-approval">{error&&<p role="alert" className="error-banner">{error}</p>}{pending&&node&&actor&&<ApprovalCard approval={pending} node={node} facts={snapshot?.workflow.analysis?.facts??[]} actor={actor} busy={busy} mailPreview={snapshot?.mailPreview} onDecision={async(approval,decision)=>{
    if(busy)return;setBusy(true);setError("");try{const session=await apiRequest<{actor:SessionActor}>("/api/session/actor");const body={actor:session.actor.id,expectedVersion:approval.version};
      if(approval.kind==="CONFIRM")await apiRequest(`/api/workflows/${workflowId}/confirm`,{...body,approvalId:approval.id,decision});
      else await apiRequest(`/api/approvals/${approval.id}/${decision==="APPROVED"?"approve":"reject"}`,body);
    }catch(e){setError((e as Error).message);}finally{await load().catch(()=>{});await onChanged();setBusy(false);}
  }}/>}</div>;
}
