"use client";
import { useState } from "react";
import { apiRequest } from "./client";
export function TaskSchedule({taskId,onChanged}:{taskId:string;onChanged:()=>Promise<void>}) {
  const [at,setAt]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  return <form className="schedule-form" onSubmit={async e=>{e.preventDefault();if(busy||!at)return;setBusy(true);setError("");try{const due=new Date(at);if(!Number.isFinite(due.getTime())||due.getTime()<=Date.now())throw new Error("미래 시간을 선택하세요.");await apiRequest(`/api/tasks/${taskId}/triggers`,{type:"TIME",config:{},nextDueAt:due.toISOString()});setAt("");await onChanged();}catch(failure){setError((failure as Error).message);}finally{setBusy(false);}}}>
    <label>다시 확인할 시간<input aria-label="다시 확인할 시간" type="datetime-local" required value={at} onChange={e=>setAt(e.target.value)} disabled={busy}/></label><button className="button secondary" disabled={busy||!at}>예약</button>{error&&<p role="alert">{error}</p>}
  </form>;
}
