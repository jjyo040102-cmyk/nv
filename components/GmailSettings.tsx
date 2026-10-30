"use client";
import { useEffect, useState } from "react";
import { apiRequest } from "./client";
type Status = { configured: boolean; connected: boolean; email: string | null; watching: boolean; lastError: string | null; realMailEnabled: boolean };
export function GmailSettings() {
  const [status, setStatus] = useState<Status | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; apiRequest<Status>("/api/connectors/gmail").then(data => { if (active) setStatus(data); }).catch(e => { if (active) setError(e.message); });
    if (new URLSearchParams(window.location.search).get("gmail") === "failed") setError("Gmail 연결을 완료하지 못했습니다. 권한을 허용하고 다시 연결하세요.");
    return () => { active = false; }; }, []);
  async function connect() { setBusy(true); setError(""); try { const { url } = await apiRequest<{ url: string }>("/api/connectors/gmail/connect", {}); window.location.assign(url); } catch (e) { setError((e as Error).message); setBusy(false); } }
  return <section className="panel provider-settings"><div className="panel-heading"><div><h2>Gmail</h2><p>선택한 메일을 업무로 가져오고, 승인한 답장을 보냅니다.</p></div><span className="badge neutral">{status?.connected ? status.email : "연결 전"}</span></div>
    {(error || status?.lastError) && <p role="alert" className="error-banner">{error || status?.lastError}</p>}
    {status && !status.configured && <p className="muted">서버의 Google OAuth 설정을 완료하면 연결할 수 있습니다. 설치 안내에 필요한 항목이 정리되어 있습니다.</p>}
    {status?.connected && <label className="simple-check"><input type="checkbox" checked={status.watching} disabled={busy} onChange={async e => { setBusy(true); try { setStatus(await apiRequest<Status>("/api/connectors/gmail", { watching: e.target.checked })); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); } }}/> 가져온 업무의 새 답장 자동 확인</label>}
    {status?.connected && !status.realMailEnabled && <p className="muted">수신 연결은 준비됐습니다. 실제 발송은 서버의 메일 발송 설정을 켠 뒤 사용할 수 있습니다.</p>}
    <div className="provider-actions"><button className="button primary" disabled={busy || !status?.configured} onClick={() => void connect()}>{status?.connected ? "다시 연결" : "Gmail 연결"}</button>
      {status?.connected && <button className="button secondary" disabled={busy} onClick={async () => { setBusy(true); try { await apiRequest("/api/connectors/gmail", {}, "DELETE"); setStatus(await apiRequest<Status>("/api/connectors/gmail")); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>연결 해제</button>}</div>
  </section>;
}
