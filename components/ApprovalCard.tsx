"use client";
import { useEffect, useState } from "react";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import type { ApprovalRecord } from "@/lib/db/repository";
import type { Fact, SessionActor } from "@/lib/domain/types";
import type { GraphNode } from "@/lib/workflow/builder";
import { PolicyBadge } from "./StatusBadge";
import { ConfirmDialog } from "./ConfirmDialog";
import type { MailPreview } from "@/lib/workflow/engine";
export function ApprovalCard({ approval, node, facts, actor, busy, onDecision, mailPreview }: { approval: ApprovalRecord; node: GraphNode; facts: Fact[]; actor: SessionActor; busy: boolean; onDecision: (approval: ApprovalRecord, decision: "APPROVED" | "REJECTED") => void; mailPreview?:MailPreview }) {
  const [acknowledged, setAcknowledged] = useState(false); const [rejecting, setRejecting] = useState(false);
  useEffect(() => { setAcknowledged(false); setRejecting(false); }, [approval.id]);
  const isApproval = approval.kind === "APPROVAL"; const allowed = !isApproval || actor.role === "APPROVER";
  const expense = facts.find(fact => fact.key === "expenseKrw")?.value;
  const simulated = node.actionType === "demo.email.simulate";
  const email = node.actionType === "external.email.send";
  return <section className={`approval-card ${isApproval ? "approval-gate" : "confirmation-gate"}`} aria-labelledby="approval-title"><div className="approval-heading"><span className="approval-icon">{isApproval ? <LockKeyhole size={22} /> : <ShieldCheck size={22} />}</span><div><p className="eyebrow">HUMAN DECISION REQUIRED</p><h2 id="approval-title">{isApproval ? "승인 후 다음 단계로 진행합니다" : "실행 전 최종 확인이 필요합니다"}</h2></div><PolicyBadge policy={approval.kind} /></div>
    <div className="approval-detail-grid"><div><small>실행할 작업</small><strong>{node.title}</strong></div><div><small>멈춘 이유</small><strong>{isApproval && expense ? `출장비 ${Number(expense).toLocaleString("ko-KR")}원 · 승인 기준 이상` : "사용자의 명시적인 확인이 필요합니다."}</strong></div><div><small>사용할 데이터</small><span>{email ? "아래의 정확한 받는 사람·본문·첨부파일" : simulated ? "교육 운영팀 · 검증된 명단과 회신 문서" : "원문에서 추출한 비용과 교육 정보"}</span></div><div><small>외부 영향 · 되돌리기</small><span>{email ? mailPreview?.actual ? "실제 Gmail 발송 · 보낸 메일은 되돌릴 수 없음" : "모의 발송 · 실제 외부 발송 없음" : simulated ? "데모 시뮬레이션 · 실제 발송 없음 · sent: false" : "비용 승인 기록 · 실제 결제 없음 · 임시 파일 폐기 가능"}</span></div></div>
    {email && mailPreview && <div className="mail-preview"><dl><div><dt>받는 사람</dt><dd>{mailPreview.to}</dd></div><div><dt>제목</dt><dd>{mailPreview.subject}</dd></div></dl><pre>{mailPreview.body}</pre>{mailPreview.attachments.length ? <ul>{mailPreview.attachments.map(file=><li key={file.id}><a href={`/api/artifacts/${file.id}`} target="_blank" rel="noreferrer">{file.name}</a></li>)}</ul>:<p className="muted">첨부파일 없음</p>}</div>}
    <div className="approval-policy"><ShieldCheck size={14} /><span>정책 v{approval.policyVersion} · {node.policy.matchedRules.join(", ")}</span></div>
    {!allowed && <p className="role-notice">승인자 권한이 필요합니다. 체험 중이면 상단에서 승인자 역할을 선택하세요.</p>}
    <label className="acknowledgment"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} disabled={busy || !allowed} /><span>이 작업의 영향과 조건을 확인했습니다.</span></label>
    <div className="approval-actions"><button className="button secondary" disabled={busy || !allowed} onClick={() => setRejecting(true)}>거절</button><button className="button primary" disabled={busy || !allowed || !acknowledged} onClick={() => onDecision(approval, "APPROVED")}>{isApproval ? "승인하고 계속" : "확인하고 계속"}<ArrowRight size={16} /></button><span>대기 시간이 지나도 자동 승인되지 않습니다.</span></div>
    {rejecting && <ConfirmDialog title="이 요청을 거절할까요?" description="워크플로를 중단하고 남아 있는 임시 파일을 실제로 삭제합니다. 확정된 파일은 보존됩니다." confirmLabel="거절하고 폐기" busy={busy} onCancel={() => setRejecting(false)} onConfirm={() => { setRejecting(false); onDecision(approval, "REJECTED"); }} />}
  </section>;
}
