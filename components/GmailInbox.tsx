"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "./client";
type Message = { id: string; subject: string; from: string; receivedAt: string };
export function GmailInbox() {
  const router = useRouter(), [messages, setMessages] = useState<Message[] | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <div className="gmail-import"><button className="button secondary" disabled={busy} onClick={async () => { if (messages) { setMessages(null); return; } setBusy(true); setError(""); try { const result = await apiRequest<{ messages: Message[] }>("/api/connectors/gmail/messages"); setMessages(result.messages); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>{busy ? "메일 확인 중…" : messages ? "메일 목록 닫기" : "Gmail에서 가져오기"}</button>
    {error && <p role="alert" className="error-banner">{error} <a href="/settings">연결 설정</a></p>}
    {messages && <section className="panel inbox-list" aria-label="Gmail 수신 메일"><h3>업무로 가져올 메일</h3>{messages.length === 0 && <p className="muted">받은편지함이 비어 있습니다.</p>}{messages.map(message => <div className="task-card compact" key={message.id}><div><strong>{message.subject || "제목 없음"}</strong><p className="muted">{message.from}</p></div><button className="button secondary" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { const result = await apiRequest<{ taskId: string }>("/api/connectors/gmail/messages", { messageId: message.id }); router.push(`/tasks/${result.taskId}`); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>업무로 가져오기</button></div>)}</section>}
  </div>;
}
