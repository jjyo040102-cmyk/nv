"use client";
import { useEffect, useState } from "react";
import { MailCheck, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { apiRequest } from "./client";
type Contact={id:string;emailAddress:string;displayName:string|null;autoReplyEnabled:boolean;verifiedAt:string};
export function VerifiedContactsSettings({initialContacts}:{initialContacts?:Contact[]}){const[contacts,setContacts]=useState<Contact[]>(initialContacts??[]);const[email,setEmail]=useState("");const[name,setName]=useState("");const[message,setMessage]=useState("");
  useEffect(()=>{if(initialContacts)return;apiRequest<{contacts:Contact[]}>("/api/verified-contacts").then(x=>setContacts(x.contacts)).catch(e=>setMessage(e.message));},[initialContacts]);
  async function add(){if(!email.trim())return;try{const r=await apiRequest<{contact:Contact}>("/api/verified-contacts",{emailAddress:email.trim(),displayName:name.trim()||null,autoReplyEnabled:true});setContacts(v=>[r.contact,...v.filter(x=>x.id!==r.contact.id)]);setEmail("");setName("");setMessage("인증된 주소로 저장했습니다.");}catch(e){setMessage((e as Error).message);}}
  async function remove(id:string){try{await apiRequest(`/api/verified-contacts/${id}`,undefined,"DELETE");setContacts(v=>v.filter(x=>x.id!==id));}catch(e){setMessage((e as Error).message);}}
  async function toggle(c:Contact){try{const r=await apiRequest<{contact:Contact}>(`/api/verified-contacts/${c.id}`,{autoReplyEnabled:!c.autoReplyEnabled},"PATCH");setContacts(v=>v.map(x=>x.id===c.id?r.contact:x));}catch(e){setMessage((e as Error).message);}}
  return <section className="panel verified-settings"><div className="panel-heading"><div><h2><MailCheck size={20}/> 인증된 메일</h2><p>자동 답장은 정확히 인증된 주소에만 허용됩니다.</p></div><span className="badge status-verified">보안 기본값</span></div>
    <div className="verified-rule"><ShieldAlert size={19}/><div><strong>주소가 한 글자라도 다르면 자동 답장하지 않습니다.</strong><p>표시 이름이 같거나 Gmail·Naver 등 다른 주소로 바뀌어도 인증된 계정으로 보지 않습니다. 인증되지 않은 발신자는 항상 <b>승인 후 답장</b>합니다. Reply-To나 발신 인증이 의심스러워도 자동 발송하지 않습니다.</p></div></div>
    <div className="contact-add"><input aria-label="인증할 이메일 주소" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com"/><input aria-label="표시 이름" value={name} onChange={e=>setName(e.target.value)} placeholder="이름 (선택)"/><button className="button primary" onClick={()=>void add()}><Plus size={16}/> 주소 추가</button></div>
    <div className="contact-list">{contacts.length?contacts.map(c=><div className="contact-row" key={c.id}><span><strong>{c.displayName||c.emailAddress}</strong>{c.displayName&&<small>{c.emailAddress}</small>}</span><label className="contact-auto"><input type="checkbox" checked={c.autoReplyEnabled} onChange={()=>void toggle(c)}/> 자동 답장 (추천)</label><button className="icon-button" aria-label={`${c.emailAddress} 삭제`} onClick={()=>void remove(c.id)}><Trash2 size={16}/></button></div>):<div className="empty-inline">아직 인증된 메일 주소가 없습니다.</div>}</div>{message&&<div role="status" className="muted settings-message">{message}</div>}
  </section>;
}
