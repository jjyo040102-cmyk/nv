"use client";
import { useEffect, useState } from "react";
import type { CredentialMetadata } from "@/lib/providers/credentials";
import type { ProviderPreset } from "@/lib/providers/presets";
import type { ProviderHealth } from "@/lib/providers/provider";
import { apiRequest, type AppSettings } from "./client";
import { ConfirmDialog } from "./ConfirmDialog";

type ProviderData = { presets: ProviderPreset[]; selected: AppSettings; credentials: CredentialMetadata[] };
export function ProviderSettings({ initialData }: { initialData?: ProviderData }) {
  const [data, setData] = useState<ProviderData | null>(initialData ?? null);
  const [model, setModel] = useState(initialData?.selected.model ?? "");
  const [apiKey, setApiKey] = useState(""), [busy, setBusy] = useState(false), [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState(""), [error, setError] = useState(""), [health, setHealth] = useState<ProviderHealth | null>(null);
  async function load() {
    const result = await apiRequest<ProviderData>("/api/providers");
    setData(result); setModel(result.selected.model);
  }
  useEffect(() => {
    if (initialData) return;
    let active = true;
    apiRequest<ProviderData>("/api/providers").then(result => { if (active) { setData(result); setModel(result.selected.model); } })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [initialData]);
  async function saveCredential() {
    if (!apiKey) return;
    await apiRequest("/api/providers/credentials", { provider: "nebius", apiKey });
    setApiKey("");
    const result = await apiRequest<{ credentials: CredentialMetadata[] }>("/api/providers/credentials");
    setData(previous => previous ? { ...previous, credentials: result.credentials } : previous);
  }
  async function save() {
    setBusy(true); setError(""); setMessage(""); setHealth(null);
    try {
      await saveCredential();
      await apiRequest("/api/providers", { providerId: "nebius", model, effort: null });
      await load(); setMessage("Nebius 모델 설정을 저장했습니다. 다음 계획부터 적용됩니다.");
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setError(""); setHealth(null);
    try {
      await saveCredential();
      const result = await apiRequest<{ health: ProviderHealth }>("/api/providers/test", { provider: "nebius", model });
      setHealth(result.health);
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  async function disconnect() {
    setBusy(true); setError("");
    try {
      await apiRequest("/api/providers/credentials", { provider: "nebius" }, "DELETE");
      setApiKey(""); setHealth(null); await load(); setDeleting(false); setMessage("저장된 Nebius API 키를 삭제했습니다.");
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  const credential = data?.credentials.find(value => value.provider === "nebius");
  const known = data?.presets.some(preset => preset.model === model);
  return <section className="panel provider-settings">
    <div className="panel-heading"><div><h2>Nebius × NVIDIA</h2><p>NVIDIA 모델이 계획을 만들고, ActFlow가 정책·실행·검증을 관리합니다.</p></div></div>
    <p>Nebius Token Factory에 연결합니다. 모델 ID는 계정에서 사용 가능한 NVIDIA 모델로 지정하세요.</p>
    {error && <div role="alert" className="error-banner">{error}</div>}
    {message && <div role="status" className="success-banner">{message}</div>}
    <div className="provider-form">
      <div className="field"><label htmlFor="model-select">NVIDIA 분석 모델</label>
        <select id="model-select" value={known ? model : "custom"} disabled={busy || !data} onChange={event => { setModel(event.target.value === "custom" ? "nvidia/" : event.target.value); setHealth(null); }}>
          {data?.presets.map(preset => <option value={preset.model} key={preset.model}>{preset.label}</option>)}
          <option value="custom">NVIDIA 모델 ID 직접 입력</option>
        </select>
        {!known && <input aria-label="NVIDIA 모델 ID" value={model} onChange={event => { setModel(event.target.value); setHealth(null); }} spellCheck={false} disabled={busy || !data}/>}
        <small className="field-hint">연결 테스트가 모델 목록과 실제 추론을 확인합니다.</small>
      </div>
      <div className="credential-section"><div className="credential-label"><strong>Nebius API 키</strong><span className="badge neutral">{credential?.saved ? "저장됨 " + credential.maskedHint : "저장된 키 없음"}</span></div>
        <div className="field"><label htmlFor="api-key">API 키</label><input id="api-key" type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="off" spellCheck={false} disabled={busy || !data} placeholder={credential?.saved ? "변경할 때만 입력하세요" : "Nebius API 키를 입력하세요"}/>
        <small className="field-hint">{credential?.storage === "encrypted" ? "암호화된 저장소에 보관됩니다." : "암호화 마스터 키가 없으면 서버 메모리에만 보관됩니다."}</small></div>
      </div>
    </div>
    {health && <div role="status" className={health.ok ? "success-banner" : "error-banner"}>{health.message} · {health.model}{health.latencyMs !== undefined ? " · " + Math.round(health.latencyMs) + " ms" : ""}</div>}
    <div className="provider-actions">
      <button className="button secondary" disabled={busy || !data || !model} onClick={() => void test()}>연결 테스트</button>
      <button className="button primary" disabled={busy || !data || !model} onClick={() => void save()}>설정 저장</button>
      {credential?.saved && <button className="button danger-ghost" disabled={busy} onClick={() => setDeleting(true)}>연결 해제 · 키 삭제</button>}
    </div>
    {deleting && <ConfirmDialog title="저장된 Nebius API 키를 삭제할까요?" description="다음 분석에는 새 키가 필요합니다." confirmLabel="키 삭제" busy={busy} onCancel={() => setDeleting(false)} onConfirm={() => void disconnect()}/>}
  </section>;
}
