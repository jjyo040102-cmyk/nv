"use client";
import { useEffect, useState } from "react";
import { Save, ShieldCheck, Zap } from "lucide-react";
import { apiRequest, type AppSettings } from "./client";
export function ExecutionModeSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null); const [enabled, setEnabled] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  useEffect(() => { apiRequest<{ settings: AppSettings }>("/api/settings").then(data => { setSettings(data.settings); setEnabled(data.settings.preExecutionEnabled); }).catch(error => setMessage(error.message)); }, []);
  async function save() { setBusy(true); try { const data = await apiRequest<{ settings: AppSettings }>("/api/settings", { executionMode: enabled ? "PRE_EXECUTION" : "MANUAL", preExecutionEnabled: enabled }); setSettings(data.settings); setMessage("실행 방식을 저장했습니다. 다음 문서 분석에 적용됩니다."); } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); } }
  return <section className="panel execution-settings"><div className="panel-heading"><div><h2><Zap size={20} /> 실행 방식</h2><p>기본은 수동 실행입니다. 분석과 실행은 각각 직접 시작합니다.</p></div><span className="badge neutral">{settings?.preExecutionEnabled ? "사전 실행 ON" : "수동 실행 · OFF"}</span></div><div className="mode-option"><div><h3>승인 대기 중 사전 준비</h3><p>실행을 시작한 뒤 승인 대기 동안 되돌릴 수 있는 로컬 문서만 임시로 준비합니다.<br />외부 발송은 별도 확인을 기다립니다.</p></div><label className="switch"><input type="checkbox" aria-label="사전 실행" checked={enabled} onChange={event => setEnabled(event.target.checked)} disabled={busy} /><span /><strong>{enabled ? "ON" : "OFF"}</strong></label></div><div className="mode-safety"><ShieldCheck size={17} /> 준비된 결과는 승인 전까지 미확정이며, 거절 시 실제로 삭제됩니다.</div><div className="provider-actions"><button className="button primary" disabled={busy} onClick={() => void save()}><Save size={16} /> 실행 방식 저장</button>{message && <span role="status" className="muted">{message}</span>}</div></section>;
}
