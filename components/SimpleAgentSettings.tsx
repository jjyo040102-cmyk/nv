"use client";
import { useState } from "react";
import { Bot, CheckCircle2, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { apiRequest, type AppSettings } from "./client";

type Props={initialSettings:AppSettings};
export function SimpleAgentSettings({initialSettings}:Props){
  const [settings,setSettings]=useState(initialSettings);const[busy,setBusy]=useState(false);const[message,setMessage]=useState("");
  const update=<K extends keyof AppSettings>(key:K,value:AppSettings[K])=>setSettings(s=>({...s,[key]:value}));
  async function save(){setBusy(true);setMessage("");try{const payload={automationProfile:settings.automationProfile,autoContinueEnabled:settings.autoContinueEnabled,projectMemoryEnabled:settings.projectMemoryEnabled,emailTaskDetectionEnabled:settings.emailTaskDetectionEnabled,autoLinkWorkEnabled:settings.autoLinkWorkEnabled,replanOnNewInfoEnabled:settings.replanOnNewInfoEnabled,securityLevel:"HIGH"};const result=await apiRequest<{settings:AppSettings}>("/api/settings",payload);setSettings(result.settings);setMessage("설정을 저장했습니다.");}catch(error){setMessage((error as Error).message);}finally{setBusy(false);}}
  const toggles:[keyof AppSettings,string,string][]=[
    ["autoContinueEnabled","자동 이어하기","답장이나 새로운 정보가 오면 진행 중이던 작업을 이어서 처리합니다."],
    ["projectMemoryEnabled","프로젝트 기억하기","이전 대화, 파일, 결정 내용을 다음 작업에 활용합니다."],
    ["emailTaskDetectionEnabled","새 메일에서 업무 찾기","새 메일의 요청을 찾아 작업으로 연결합니다."],
    ["autoLinkWorkEnabled","이전 업무와 자동 연결","관련 메일과 작업을 기존 업무에 자동으로 연결합니다."],
    ["replanOnNewInfoEnabled","새 정보로 계획 다시 세우기","상황이 바뀌면 안전한 범위에서 다음 계획을 갱신합니다."]
  ];
  return <section className="panel simple-settings"><div className="panel-heading"><div><h2><Bot size={20}/> AI 행동</h2><p>복잡한 설정 없이 자동화 수준만 선택하세요.</p></div><span className="badge demo-badge">간편 설정</span></div>
    <div className="simple-setting-block"><h3>AI 작업 방식</h3><div className="choice-grid">{[
      ["SAFE","안전하게","준비와 분석을 중심으로 진행합니다."],
      ["AUTOMATIC","자동으로 처리 (추천)","안전한 내부 작업은 자동으로 진행하고 중요한 외부 행동만 확인합니다."],
      ["CUSTOM","직접 설정","세부 실행 규칙을 고급 설정에서 조절합니다."]
    ].map(([value,label,desc])=><button type="button" key={value} className={`choice-card ${settings.automationProfile===value?"selected":""}`} onClick={()=>update("automationProfile",value as AppSettings["automationProfile"])}><strong>{label}</strong><small>{desc}</small>{settings.automationProfile===value&&<CheckCircle2 size={17}/>}</button>)}</div></div>
    <div className="simple-toggle-list">{toggles.map(([key,label,desc])=><label className="simple-toggle" key={String(key)}><span><strong>{label} <em>(추천)</em></strong><small>{desc}</small></span><input type="checkbox" checked={Boolean(settings[key])} onChange={e=>update(key,e.target.checked as never)}/></label>)}</div>
    <div className="simple-setting-block security-choice"><div><h3><ShieldCheck size={18}/> 보안 보호</h3><p>외부 요청·파일 전송·비밀정보 검사를 항상 가장 높은 수준으로 적용합니다.</p></div><span className="badge status-verified">높음 (추천) · 항상 적용</span></div>
    <div className="external-action-note"><ShieldCheck size={18}/><span><strong>중요한 외부 작업</strong><small>메일 발송, 외부 파일 전송, 삭제처럼 되돌리기 어려운 작업은 <b>확인 후 실행 (추천)</b>합니다.</small></span></div>
    <div className="provider-actions"><button className="button primary" disabled={busy} onClick={()=>void save()}><Save size={16}/>{busy?<><RefreshCw className="spin" size={15}/> 저장 중</>:"간편 설정 저장"}</button>{message&&<span role="status" className="muted">{message}</span>}</div>
  </section>;
}
