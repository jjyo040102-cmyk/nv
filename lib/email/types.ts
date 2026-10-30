import type { RawEmailEnvelope } from "../events/email-normalizer";
import type { OutgoingItem } from "../security/data-guard";

export type MailDraft = {
  ownerSessionId?: string;
  inboundMessageId?: string;
  idempotencyKey?: string;
  attachments?: Array<{name:string;contentType:string;bytes:Buffer}>;
  to: string;
  subject: string;
  body: string;
  threadId: string | null;
};

export type MailSendResult = {
  ok: boolean;
  sent: boolean;
  messageId: string;
  externalEffect: "SIMULATED" | "ACTUAL";
  remoteVerified?: boolean;
  checkedAt?: string;
  contentSha256?: string;
};

export interface MailTransport {
  readonly name: string;
  readonly externalEffect?: "SIMULATED" | "ACTUAL";
  preflight?(ownerSessionId: string, input: MailDraft): Promise<void>;
  sendDraft(input: MailDraft): Promise<MailSendResult>;
}

export type EmailIngestResult = {
  taskId: string;
  messageId: string;
  duplicate: boolean;
  autoReplyEligible: boolean;
  identityReasons: string[];
};

export type EmailReplyDraft = {
  subject: string;
  body: string;
  attachments?: OutgoingItem[];
  artifactIds?: string[];
  bulkExport?: boolean;
};

export type EmailReplyResult = {
  status: "SENT" | "WAITING_APPROVAL" | "BLOCKED";
  externalEffect?: "NONE" | "SIMULATED" | "ACTUAL";
  workflowId: string;
  approvalId: string | null;
};

export type TrustedEmailInput = RawEmailEnvelope;
