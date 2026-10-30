"use client";
import { useState } from "react";
import { apiRequest } from "./client";
import Link from 'next/link';
export function LoginForm() {
  const [username, setUsername] = useState(""), [password, setPassword] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  return <div className="login-screen"><form className="panel login-card" onSubmit={async event => {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try { await apiRequest("/api/auth/login", { username, password }); window.location.assign("/"); }
    catch (failure) { setError((failure as Error).message); setBusy(false); }
  }}><span className="eyebrow">ACTFLOW</span><h1>내 업무에 로그인</h1><p className="muted">계정에 연결된 작업과 승인 내역을 이어갑니다.</p>
    <label>아이디<input name="username" autoComplete="username" required maxLength={101} value={username} onChange={e => setUsername(e.target.value)} disabled={busy}/></label>
    <label>비밀번호<input name="password" type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={e => setPassword(e.target.value)} disabled={busy}/></label>
    {error && <p role="alert" className="error-banner">{error}</p>}<button className="button primary" disabled={busy}>{busy ? "로그인 중…" : "로그인"}</button>
    <p className="muted">ActFlow는 NVIDIA 모델과 Gmail을 연결해 업무를 계획하고, 승인과 검증을 거쳐 실행합니다.</p><Link href="/privacy">데이터 사용 안내 · Privacy</Link>
  </form></div>;
}
