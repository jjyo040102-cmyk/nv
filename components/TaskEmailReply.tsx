"use client";
import Link from 'next/link';
import {useState} from 'react';
import type {EmailReplyResult} from '@/lib/email/types';
import {apiRequest} from './client';
import {replySubjectBase} from '@/lib/email/subject';
export function TaskEmailReply({taskId,onChanged,disabled=false,inboundSubject}:{taskId:string;inboundSubject?:string;onChanged:()=>Promise<void>;disabled?:boolean}){
  const [subject,setSubject]=useState('Re: '+replySubjectBase(inboundSubject??'업무 회신')),[body,setBody]=useState(''),[busy,setBusy]=useState(false),[result,setResult]=useState<EmailReplyResult|null>(null),[error,setError]=useState('');
  async function submit(){setBusy(true);setError('');try{const response=await apiRequest<{reply:EmailReplyResult}>(`/api/tasks/${taskId}/reply`,{subject,body});setResult(response.reply);await onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <details className="panel task-email-reply"><summary>메일 답장 작성</summary><p>수신 메일이 있는 작업에서만 사용할 수 있습니다. 미인증 상대는 반드시 승인 단계에서 멈춥니다. Gmail 연결 후 승인한 내용으로 실제 발송하며, 보낸편지함에서 결과를 확인합니다.</p><label>답장 제목<input value={subject} onChange={e=>setSubject(e.target.value)} maxLength={500} disabled={busy||disabled}/></label><label>답장 본문<textarea value={body} onChange={e=>setBody(e.target.value)} maxLength={20000} disabled={busy||disabled}/></label><button type="button" className="button primary" onClick={()=>void submit()} disabled={busy||disabled||!subject.trim()||!body.trim()}>답장 검사 및 처리</button>{error&&<p role="alert">{error}</p>}{result&&<p role="status">{result.status==='SENT'?(result.externalEffect==='SIMULATED'?'모의 발송이 검증됐습니다. 실제 메일은 발송하지 않았습니다.':'메일 전송 결과가 검증됐습니다.'):result.status==='WAITING_APPROVAL'?'사용자 승인 대기 — 아직 보내지 않았습니다.':'전송을 차단했습니다. 작업 기록을 확인하세요.'} <Link href={`/workflows/${result.workflowId}`}>승인 및 결과 보기</Link></p>}</details>;
}
