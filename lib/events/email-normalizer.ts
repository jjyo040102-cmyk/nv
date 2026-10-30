import type {SenderAuthStatus} from '../tasks/types';
export type RawEmailAuth={status?:SenderAuthStatus;trustedAdapter?:boolean;spf?:'PASS'|'FAIL'|'MISSING';dkim?:'PASS'|'FAIL'|'MISSING';dmarc?:'PASS'|'FAIL'|'MISSING'};
export type RawEmailEnvelope={from:string;replyTo?:string|null;messageId:string;threadId?:string|null;subject?:string;body?:string;auth?:RawEmailAuth;receivedAt?:string};
export type NormalizedEmailAuth={status:SenderAuthStatus;trustedAdapter:boolean;spf:'PASS'|'FAIL'|'MISSING';dkim:'PASS'|'FAIL'|'MISSING';dmarc:'PASS'|'FAIL'|'MISSING'};
export type NormalizedEmailEvent={fromAddress:string;fromDisplayName:string|null;replyToAddress:string|null;messageId:string;threadId:string|null;subject:string;body:string;auth:NormalizedEmailAuth;receivedAt:string};
/** Parse exactly one conservative addr-spec; no case/alias/domain normalization. */
export function normalizeEmailAddress(value:string):string {
  if(typeof value!=="string" || /[\r\n\0]/.test(value) || value.length>512) throw new Error("Invalid email address");
  const trimmed=value.trim();
  const angle=trimmed.match(/^([^<>]*?)<([^<>]+)>$/);
  if(/[<>]/.test(trimmed)&&!angle)throw new Error("Invalid email address");
  const display=angle?.[1]?.trim()??"";
  if((display.includes(",")||display.includes(";"))&& !/^"[^"\\]*"$/.test(display))throw new Error("Multiple email addresses are not allowed");
  const candidate=(angle?.[2]??trimmed).trim();
  const match=candidate.match(/^([A-Za-z0-9!#$%&'*+\/=?^_`{|}~.-]+)@([A-Za-z0-9.-]+)$/);
  if(!match||candidate.length>254||match[1].length>64||match[1].startsWith(".")||match[1].endsWith(".")||match[1].includes(".."))throw new Error("Invalid email address");
  const domain=match[2];
  if(!domain.includes(".")||domain.split(".").some(label=>!label||label.length>63||label.startsWith("-")||label.endsWith("-")))throw new Error("Invalid email domain");
  return candidate;
}
function displayName(value:string):string|null{const m=value.trim().match(/^(.*?)\s*<[^<>]+>\s*$/);if(!m)return null;const d=m[1].trim().replace(/^['"]|['"]$/g,'');return d||null;}
export function normalizeEmailEnvelope(raw:RawEmailEnvelope):NormalizedEmailEvent{
  if(!raw.messageId?.trim()||raw.messageId.length>500||/[\r\n\0]/.test(raw.messageId))throw new Error("Invalid message identity");
  if(raw.threadId&&(raw.threadId.length>500||/[\r\n\0]/.test(raw.threadId)))throw new Error("Invalid thread identity");
  if((raw.subject?.length??0)>2000||/[\r\n\0]/.test(raw.subject??"")||(raw.body?.length??0)>1_000_000)throw new Error("Invalid email content");
  const a=raw.auth;return {fromAddress:normalizeEmailAddress(raw.from),fromDisplayName:displayName(raw.from),replyToAddress:raw.replyTo?normalizeEmailAddress(raw.replyTo):null,messageId:raw.messageId.trim(),threadId:raw.threadId?.trim()||null,subject:raw.subject??'',body:raw.body??'',auth:{status:a?.status??'MISSING',trustedAdapter:a?.trustedAdapter===true,spf:a?.spf??'MISSING',dkim:a?.dkim??'MISSING',dmarc:a?.dmarc??'MISSING'},receivedAt:raw.receivedAt??new Date().toISOString()};}
