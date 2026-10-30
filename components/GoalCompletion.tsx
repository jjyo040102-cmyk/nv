"use client";
import { useEffect, useState } from "react";
import type { GoalContractView } from "@/lib/tasks/goal-contract";
import { apiRequest } from "./client";
export function GoalCompletion({ taskId, contract, terminal, onChanged }: {taskId:string;contract:GoalContractView;terminal:boolean;onChanged:()=>Promise<void>}) {
  const [checked,setChecked]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{setChecked([]);},[contract.version,taskId]);
  const pending=contract.requirements.filter(item=>!item.passed),passed=contract.requirements.filter(item=>item.passed);
  const needs=pending.filter(item=>item.canConfirm);
  return <section id="goal-completion" className="panel completion-panel" aria-label="완료 조건"><div className="panel-heading"><div><h2>완료 조건</h2><p>{passed.length}/{contract.requirements.length} 확인됨{needs.length>0&&` · 직접 확인 ${needs.length}개`}</p></div></div>
    {passed.length>0&&<details className="completion-evidence"><summary>확인된 조건 {passed.length}개 보기</summary><ul className="completion-list">{passed.map(item=><li key={item.id}><span className="condition-mark passed">✓</span><div><strong>{item.label}</strong><p>{item.evidence}</p></div></li>)}</ul></details>}
    {pending.length>0&&<ul className="completion-list">{pending.map(item=><li key={item.id}><span className="condition-mark">○</span><div><strong>{item.label}</strong><p>{item.evidence}</p>{item.canConfirm&&!terminal&&<label><input type="checkbox" disabled={busy} checked={checked.includes(item.id)} onChange={e=>setChecked(previous=>e.target.checked?[...previous,item.id]:previous.filter(id=>id!==item.id))}/> 직접 확인했습니다</label>}</div></li>)}</ul>}
    {error&&<p role="alert" className="error-banner">{error}</p>}
    {!terminal&&<button className="button primary" disabled={busy||!contract.readyToComplete||needs.some(item=>!checked.includes(item.id))} onClick={async()=>{setBusy(true);setError("");try{await apiRequest(`/api/tasks/${taskId}/complete`,{version:contract.version,confirmedIds:checked});await onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{busy?"결과 확인 중…":"결과 확인하고 완료"}</button>}
  </section>;
}
