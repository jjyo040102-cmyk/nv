import { createHash, randomBytes } from "node:crypto";
import { ApiError } from "../api/responses";
import { normalizeEmailAddress, type RawEmailEnvelope } from "../events/email-normalizer";
import { GmailConnection } from "./gmail-connection";
import { googleRequest, type GoogleRequest } from "./google-http";
import type { MailDraft, MailSendResult, MailTransport } from "./types";
import { replySubjectMatches } from './subject';

const base = "https://gmail.googleapis.com/gmail/v1/users/me";
type Part = { mimeType?: string; filename?: string; headers?: Array<{ name: string; value: string }>; body?: { data?: string; attachmentId?: string; size?: number }; parts?: Part[] };
export type GmailMessage = { id: string; threadId: string; labelIds?: string[]; internalDate?: string; payload: Part; snippet?: string };
const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const lines = (data: Buffer) => data.toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const id = (value: string) => { if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new ApiError(400, "잘못된 Gmail 메시지 ID입니다."); return value; };
export function messageHeader(message: GmailMessage, key: string): string {
  const values = message.payload.headers?.filter(header => header.name.toLowerCase() === key.toLowerCase()) ?? [];
  if (values.length > 1) throw new ApiError(409, "중복된 메일 헤더를 확인해야 합니다.");
  return values[0]?.value ?? "";
}
function flatten(part: Part): Part[] {
  const result: Part[] = [], pending = [part];
  while (pending.length) { const current = pending.shift()!; result.push(current); if (result.length > 200) throw new ApiError(413, "메일 구조가 너무 복잡합니다."); pending.push(...(current.parts ?? [])); }
  return result;
}
const normalizedBody = (body: string) => body.replace(/\r\n?/g, "\n").replace(/\n$/, "");
export function messageText(message: GmailMessage): string {
  const parts = flatten(message.payload).filter(part => part.mimeType === "text/plain" && !part.filename);
  if (!parts.length) throw new ApiError(422, "텍스트 본문이 없는 메일입니다. 필요한 내용을 문서로 첨부하세요.");
  const text = parts.map(part => Buffer.from(part.body?.data ?? "", "base64url").toString("utf8")).join("\n");
  if (!text.trim() || text.length > 100000) throw new ApiError(413, "메일 본문 크기를 확인하세요.");
  return text;
}
export function createMime(input: MailDraft, from: string, inReplyTo: string | null): string {
  if (normalizeEmailAddress(input.to) !== input.to || normalizeEmailAddress(from) !== from || !input.idempotencyKey || !/^[\w-]{1,100}$/.test(input.idempotencyKey)) throw new ApiError(400, "잘못된 발송 요청입니다.");
  if (/[\r\n\0]/.test(input.subject) || input.subject.length > 500 || input.body.length > 20000) throw new ApiError(400, "메일 제목과 본문을 확인하세요.");
  if (inReplyTo && (!/^<[^<>\r\n\0 ]{1,400}>$/.test(inReplyTo))) throw new ApiError(409, "답장할 원본 메일의 Message-ID를 확인할 수 없습니다.");
  const boundary = `actflow_${randomBytes(20).toString("hex")}`;
  const headers = [`From: ${from}`, `To: ${input.to}`, `Subject: =?UTF-8?B?${b64(input.subject)}?=`, `Message-ID: <${input.idempotencyKey}@actflow.invalid>`, "MIME-Version: 1.0",
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []), `Content-Type: multipart/mixed; boundary="${boundary}"`];
  const parts = [`--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${lines(Buffer.from(input.body, "utf8"))}`];
  for (const attachment of input.attachments ?? []) {
    if (!attachment.name || /[\r\n\0/\\]/.test(attachment.name) || !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(attachment.contentType)) throw new ApiError(400, "첨부파일 정보를 확인하세요.");
    parts.push(`--${boundary}\r\nContent-Type: ${attachment.contentType}\r\nContent-Disposition: attachment; filename*=UTF-8''${encodeURIComponent(attachment.name).replace(/'/g, "%27")}\r\nContent-Transfer-Encoding: base64\r\n\r\n${lines(attachment.bytes)}`);
  }
  return `${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}\r\n--${boundary}--\r\n`;
}

export class GmailClient implements MailTransport {
  readonly name = "gmail"; readonly externalEffect = "ACTUAL" as const;
  constructor(readonly connection: GmailConnection, private readonly http: GoogleRequest = googleRequest) {}
  async preflight(owner: string,input:MailDraft): Promise<void> {
    await this.connection.accessToken(owner);
    if(input.threadId){
      if(!input.inboundMessageId?.startsWith('gmail:'))throw new ApiError(409,'답장할 Gmail 원본이 필요합니다.');
      const source=await this.get(owner,input.inboundMessageId.slice(6));
      if(source.threadId!==input.threadId||normalizeEmailAddress(messageHeader(source,'From'))!==input.to||!replySubjectMatches(input.subject,messageHeader(source,'Subject')))throw new ApiError(409,'Gmail 원본의 상대·제목·대화가 일치하지 않습니다. 답장을 다시 확인하세요.');
      createMime(input,this.connection.email(owner),messageHeader(source,'Message-ID')||null);
    }
  }
  async request<T>(owner: string, path: string, init: RequestInit = {}, maxBytes?: number): Promise<T> {
    const token = await this.connection.accessToken(owner);
    return this.http<T>(base + path, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } }, maxBytes);
  }
  async get(owner: string, messageId: string): Promise<GmailMessage> {
    const message = await this.request<GmailMessage>(owner, `/messages/${id(messageId)}?format=full`, {}, 40 * 1024 * 1024);
    if (message.id !== messageId || !message.payload || !message.threadId) throw new ApiError(502, "Gmail 메시지 응답을 확인하지 못했습니다.");
    return message;
  }
  async inbox(owner: string): Promise<Array<{ id: string; subject: string; from: string; receivedAt: string }>> {
    const list = await this.request<{ messages?: Array<{ id: string }> }>(owner, "/messages?labelIds=INBOX&maxResults=20");
    const result = [];
    for (const item of (list.messages ?? []).slice(0, 20)) {
      const message = await this.request<GmailMessage>(owner, `/messages/${id(item.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`);
      result.push({ id: item.id, subject: messageHeader(message, "Subject"), from: messageHeader(message, "From"), receivedAt: new Date(Number(message.internalDate) || Date.now()).toISOString() });
    }
    return result;
  }
  envelope(message: GmailMessage): RawEmailEnvelope {
    // Gmail access proves mailbox provenance, not the asserted sender's identity.
    // Unknown authentication stays MISSING and requires an explicit send confirmation.
    return { from: messageHeader(message, "From"), replyTo: messageHeader(message, "Reply-To") || null, messageId: `gmail:${message.id}`, threadId: message.threadId,
      subject: messageHeader(message, "Subject"), body: messageText(message), receivedAt: new Date(Number(message.internalDate) || Date.now()).toISOString(),
      auth: { trustedAdapter: true, status: "MISSING", spf: "MISSING", dkim: "MISSING", dmarc: "MISSING" } };
  }
  async verify(owner: string, messageId: string, input: MailDraft): Promise<MailSendResult> {
    const message = await this.get(owner, messageId), from = this.connection.email(owner);
    if (!message.labelIds?.includes("SENT") || normalizeEmailAddress(messageHeader(message, "To")) !== input.to || normalizeEmailAddress(messageHeader(message, "From")) !== from ||
      messageHeader(message, "Cc") || messageHeader(message, "Bcc") || messageHeader(message, "Subject") !== input.subject ||
      messageHeader(message, "Message-ID") !== `<${input.idempotencyKey}@actflow.invalid>` || (input.threadId && message.threadId !== input.threadId) || normalizedBody(messageText(message)) !== normalizedBody(input.body)) throw new ApiError(409, "보낸편지함의 내용이 승인한 메일과 다릅니다. 자동 재발송을 중단했습니다.");
    const actual = flatten(message.payload).filter(part => part.filename);
    const expected = input.attachments ?? [];
    if (actual.length !== expected.length || new Set(actual.map(part => part.filename)).size !== actual.length) throw new ApiError(409, "발송 첨부파일 수가 일치하지 않습니다.");
    for (const attachment of expected) {
      const part = actual.find(item => item.filename === attachment.name);
      if (!part) throw new ApiError(409, "발송 첨부파일을 찾지 못했습니다.");
      const content = part.body?.data ?? (part.body?.attachmentId ? (await this.request<{ data: string }>(owner, `/messages/${id(messageId)}/attachments/${encodeURIComponent(part.body.attachmentId)}`, {}, 40 * 1024 * 1024)).data : "");
      if (digest(Buffer.from(content, "base64url")) !== digest(attachment.bytes)) throw new ApiError(409, "발송 첨부파일 해시가 일치하지 않습니다.");
    }
    return { ok: true, sent: true, messageId, externalEffect: "ACTUAL", remoteVerified: true, checkedAt: new Date().toISOString(), contentSha256: digest(JSON.stringify({ to: input.to, subject: input.subject, body: input.body, attachments: expected.map(item => ({ name: item.name, sha256: digest(item.bytes) })) })) };
  }
  async findSent(owner: string, key: string): Promise<string | null> {
    if (!/^[\w-]{1,100}$/.test(key)) throw new ApiError(400, "잘못된 발송 식별자입니다.");
    const result = await this.request<{ messages?: Array<{ id: string }> }>(owner, `/messages?maxResults=2&q=${encodeURIComponent(`in:sent rfc822msgid:${key}@actflow.invalid`)}`);
    if ((result.messages?.length ?? 0) > 1) throw new ApiError(409, "동일한 발송 식별자가 여러 개입니다. 메일 기록을 확인하세요.");
    return result.messages?.[0]?.id ?? null;
  }
  async sendDraft(input: MailDraft): Promise<MailSendResult> {
    if (!input.ownerSessionId || !input.idempotencyKey) throw new ApiError(400, "발송 소유 정보가 필요합니다.");
    const owner = input.ownerSessionId;
    const existing = await this.findSent(owner, input.idempotencyKey);
    if (existing) return this.verify(owner, existing, input);
    let inReplyTo: string | null = null;
    if (input.inboundMessageId?.startsWith("gmail:")) {
      const source = await this.get(owner, input.inboundMessageId.slice(6));
      if (source.threadId !== input.threadId || normalizeEmailAddress(messageHeader(source, "From")) !== input.to || !replySubjectMatches(input.subject,messageHeader(source,'Subject'))) throw new ApiError(409, "원본 메일의 수신자·제목 경계가 변경됐습니다.");
      inReplyTo = messageHeader(source, "Message-ID") || null;
    }
    if (input.threadId && !inReplyTo) throw new ApiError(409, "답장할 원본 메일을 확인하지 못했습니다.");
    const raw = Buffer.from(createMime(input, this.connection.email(owner), inReplyTo)).toString("base64url");
    const sent = await this.request<{ id: string }>(owner, "/messages/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ raw, ...(input.threadId ? { threadId: input.threadId } : {}) }) }, 1024 * 1024);
    return this.verify(owner, id(sent.id), input);
  }
}
