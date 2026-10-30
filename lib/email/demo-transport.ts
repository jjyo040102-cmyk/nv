import { randomUUID } from "node:crypto";
import type { MailDraft, MailSendResult, MailTransport } from "./types";

export class DemoMailTransport implements MailTransport {
  readonly name = "demo";
  readonly externalEffect = "SIMULATED" as const;
  private readonly receipts=new Map<string,MailSendResult>();
  readonly sent: MailDraft[] = [];

  async sendDraft(input: MailDraft): Promise<MailSendResult> {
    if(input.idempotencyKey&&this.receipts.has(input.idempotencyKey))return {...this.receipts.get(input.idempotencyKey)!};
    this.sent.push(structuredClone(input));
    const result:MailSendResult={ok:true,sent:true,messageId:`demo-${randomUUID()}`,externalEffect:"SIMULATED"};
    if(input.idempotencyKey)this.receipts.set(input.idempotencyKey,result);return {...result};
  }
}
