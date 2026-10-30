import { getRuntime } from "@/lib/api/runtime";
import { SimpleAgentSettings } from "@/components/SimpleAgentSettings";
import { VerifiedContactsSettings } from "@/components/VerifiedContactsSettings";
import { ProviderSettings } from "@/components/ProviderSettings";
import { ExecutionModeSettings } from "@/components/ExecutionModeSettings";
import { GmailSettings } from "@/components/GmailSettings";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveSessionActor } from "@/lib/security/session";
export const dynamic = "force-dynamic";
export default async function SettingsPage() {
  const incoming = await headers();
  try { await resolveSessionActor(new Request('http://localhost/settings',{headers:incoming})); }
  catch { redirect('/login'); }
  const settings = getRuntime().repo.getSettings();
  return <div className="settings-page"><div className="page-heading"><div><p className="eyebrow">SETTINGS</p><h1>업무 실행 설정</h1><p className="page-description">모델 연결과 실행 범위를 관리합니다.</p></div></div>
    <ProviderSettings/><GmailSettings/><SimpleAgentSettings initialSettings={settings}/>
    <details className="advanced-settings"><summary>세부 실행 규칙과 기록</summary><div className="advanced-settings-body"><VerifiedContactsSettings/><ExecutionModeSettings/><div className="control-buttons"><Link className="button secondary" href="/policies">조직 정책</Link><Link className="button secondary" href="/recorder">실행 기록</Link></div></div></details>
  </div>;
}
