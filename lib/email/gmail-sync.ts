import type Database from "better-sqlite3";
import type { EmailService } from "./service";
import { GmailClient, type GmailMessage, messageHeader } from "./gmail-client";
import { recordActivity } from "../audit/activity";
export class GmailSync {
  constructor(private readonly db: Database.Database, private readonly client: GmailClient, private readonly email: EmailService) {}
  async import(owner: string, messageId: string) {
    const message = await this.client.get(owner, messageId);
    if (message.labelIds?.some(label => ["SENT", "DRAFT", "TRASH", "SPAM"].includes(label))) throw new Error("수신 메일만 업무로 가져올 수 있습니다.");
    const result = await this.email.ingestTrusted(this.client.envelope(message), { id: "gmail-import", sessionId: owner, role: "USER" });
    this.db.prepare("INSERT OR IGNORE INTO gmail_imports(owner_session_id,gmail_message_id,imported_at) VALUES (?,?,?)").run(owner, messageId, new Date().toISOString());
    return result;
  }
  async tick(): Promise<number> {
    let imported = 0;
    const owners = this.db.prepare("SELECT owner_session_id FROM gmail_connections WHERE enabled=1 AND watch_enabled=1").all() as Array<{ owner_session_id: string }>;
    for (const { owner_session_id: owner } of owners) {
      try {
        const threads = this.db.prepare(`SELECT DISTINCT m.thread_id FROM mail_messages m JOIN living_tasks t ON t.id=m.living_task_id AND t.owner_session_id=m.owner_session_id
          WHERE m.owner_session_id=? AND m.message_id LIKE 'gmail:%' AND m.direction='INBOUND' AND m.thread_id IS NOT NULL AND t.background_watch_enabled=1 AND t.status NOT IN ('COMPLETED','CANCELLED') LIMIT 30`).all(owner) as Array<{ thread_id: string }>;
        for (const thread of threads) {
          const result = await this.client.request<{ messages?: GmailMessage[] }>(owner, `/threads/${encodeURIComponent(thread.thread_id)}?format=full`, {}, 40 * 1024 * 1024);
          for (const message of (result.messages ?? []).slice(-100)) {
            if (message.labelIds?.some(label => ["SENT", "DRAFT", "TRASH", "SPAM"].includes(label)) || !messageHeader(message, "From")) continue;
            if (this.db.prepare("SELECT 1 FROM gmail_imports WHERE owner_session_id=? AND gmail_message_id=?").get(owner, message.id)) continue;
            await this.import(owner, message.id); imported++;
          }
        }
        this.db.prepare("UPDATE gmail_connections SET synced_at=?,last_error=NULL WHERE owner_session_id=?").run(new Date().toISOString(), owner);
      } catch { this.db.prepare("UPDATE gmail_connections SET last_error=? WHERE owner_session_id=?").run("답장 확인에 실패했습니다. Gmail 연결과 가져올 메일을 확인하세요.", owner); recordActivity(this.db, owner, null, "GMAIL_SYNC_FAILED", {}); }
    }
    return imported;
  }
}
