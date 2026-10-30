"use client";
import { useEffect, useState } from "react";
import type { SessionActor } from "@/lib/domain/types";
import { apiRequest } from "./client";
export function DemoActorSelector() {
  const [actor, setActor] = useState<SessionActor | null>(null); const [demo, setDemo] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { apiRequest<{ actor: SessionActor; demoAuth: boolean }>("/api/session/actor").then(data => { setActor(data.actor); setDemo(data.demoAuth); }).catch(() => {}); }, []);
  async function change(role: "USER" | "APPROVER") {
    setBusy(true);
    try { const data = await apiRequest<{ actor: SessionActor }>("/api/session/actor", { role }); setActor(data.actor); window.dispatchEvent(new Event("actflow-actor-changed")); }
    finally { setBusy(false); }
  }
  if (!actor) return null;
  if (!demo) return <button className="button secondary" disabled={busy} onClick={async () => { setBusy(true); try { await apiRequest("/api/auth/logout", {}); window.location.assign("/login"); } finally { setBusy(false); } }}>로그아웃</button>;
  return <label className="actor-control"><span className="avatar">{actor.role === "APPROVER" ? "A" : "U"}</span><span><small>데모 역할</small><select aria-label="데모 역할" value={actor.role} disabled={busy} onChange={event => void change(event.target.value as "USER" | "APPROVER")}><option value="USER">업무 담당자</option><option value="APPROVER">승인자</option></select></span></label>;
}
