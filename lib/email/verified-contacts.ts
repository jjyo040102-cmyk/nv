import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { normalizeEmailAddress } from "../events/email-normalizer";

export type VerifiedContactRecord = {
  id: string;
  ownerSessionId: string;
  emailAddress: string;
  displayName: string | null;
  autoReplyEnabled: boolean;
  verifiedAt: string;
  createdAt: string;
  updatedAt: string;
};
type Row = { id:string; owner_session_id:string; email_address:string; display_name:string|null; auto_reply_enabled:number; verified_at:string; created_at:string; updated_at:string };
const map = (row: Row): VerifiedContactRecord => ({ id:row.id, ownerSessionId:row.owner_session_id, emailAddress:row.email_address, displayName:row.display_name, autoReplyEnabled:row.auto_reply_enabled===1, verifiedAt:row.verified_at, createdAt:row.created_at, updatedAt:row.updated_at });

export class VerifiedContactRepository {
  constructor(private readonly db: Database.Database) {}

  upsert(input:{ ownerSessionId:string; emailAddress:string; displayName?:string|null; autoReplyEnabled?:boolean }): VerifiedContactRecord {
    const exact = normalizeEmailAddress(input.emailAddress);
    const existing = this.findExact(input.ownerSessionId, exact);
    const now = new Date().toISOString();
    if (existing) {
      this.db.prepare("UPDATE verified_contacts SET display_name=?,auto_reply_enabled=?,verified_at=?,updated_at=? WHERE id=? AND owner_session_id=?")
        .run(input.displayName ?? existing.displayName, Number(input.autoReplyEnabled ?? existing.autoReplyEnabled), now, now, existing.id, input.ownerSessionId);
      return this.get(existing.id, input.ownerSessionId)!;
    }
    const id = randomUUID();
    this.db.prepare("INSERT INTO verified_contacts(id,owner_session_id,email_address,display_name,auto_reply_enabled,verified_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, input.ownerSessionId, exact, input.displayName ?? null, Number(input.autoReplyEnabled ?? true), now, now, now);
    return this.get(id, input.ownerSessionId)!;
  }

  get(id:string, ownerSessionId:string): VerifiedContactRecord|null {
    const row = this.db.prepare("SELECT * FROM verified_contacts WHERE id=? AND owner_session_id=?").get(id, ownerSessionId) as Row|undefined;
    return row ? map(row) : null;
  }

  findExact(ownerSessionId:string, emailAddress:string): VerifiedContactRecord|null {
    const exact = normalizeEmailAddress(emailAddress);
    const row = this.db.prepare("SELECT * FROM verified_contacts WHERE owner_session_id=? AND email_address=?").get(ownerSessionId, exact) as Row|undefined;
    return row ? map(row) : null;
  }

  list(ownerSessionId:string): VerifiedContactRecord[] {
    return (this.db.prepare("SELECT * FROM verified_contacts WHERE owner_session_id=? ORDER BY updated_at DESC").all(ownerSessionId) as Row[]).map(map);
  }

  update(id:string, ownerSessionId:string, patch:{ displayName?:string|null; autoReplyEnabled?:boolean }): VerifiedContactRecord {
    const current = this.get(id, ownerSessionId);
    if (!current) throw new Error("Verified contact not found");
    this.db.prepare("UPDATE verified_contacts SET display_name=?,auto_reply_enabled=?,updated_at=? WHERE id=? AND owner_session_id=?")
      .run(patch.displayName === undefined ? current.displayName : patch.displayName, Number(patch.autoReplyEnabled ?? current.autoReplyEnabled), new Date().toISOString(), id, ownerSessionId);
    return this.get(id, ownerSessionId)!;
  }

  remove(id:string, ownerSessionId:string): boolean {
    return this.db.prepare("DELETE FROM verified_contacts WHERE id=? AND owner_session_id=?").run(id, ownerSessionId).changes === 1;
  }
}
