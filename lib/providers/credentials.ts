import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { ProviderId } from "../domain/types";
import { decryptCredential, encryptCredential } from "../security/crypto";

export type CredentialMetadata = {
  provider: Exclude<ProviderId, "demo">;
  saved: boolean;
  storage: "encrypted" | "memory" | "none";
  maskedHint: string | null;
};
type CredentialRow = { ciphertext: string; iv: string; tag: string; masked_hint: string };
type MemoryEntry = { raw: string; maskedHint: string };
const volatile = new WeakMap<Database.Database, Map<string, MemoryEntry>>();
function providerName(provider: ProviderId): Exclude<ProviderId, "demo"> {
  if (provider !== "nebius") throw new Error("Nebius 자격 증명만 지원합니다.");
  return provider;
}
function scopedKey(sessionId: string, provider: ProviderId): string { return JSON.stringify([sessionId, provider]); }
function credentialContext(sessionId: string, provider: ProviderId): string { return JSON.stringify(["actflow-credential-v1", sessionId, provider]); }
function maskedHint(raw: string): string { return "••••" + raw.slice(-4); }

export class CredentialStore {
  private readonly masterKey: Buffer | null;
  private readonly memory: Map<string, MemoryEntry>;
  constructor(private readonly db: Database.Database, masterKeyHex?: string) {
    if (masterKeyHex && !/^[0-9a-fA-F]{64}$/.test(masterKeyHex)) throw new Error("ACTFLOW_MASTER_KEY는 64자리 16진수여야 합니다.");
    this.masterKey = masterKeyHex ? Buffer.from(masterKeyHex, "hex") : null;
    let memory = volatile.get(db);
    if (!memory) { memory = new Map(); volatile.set(db, memory); }
    this.memory = memory;
  }

  async saveCredential(sessionId: string, provider: ProviderId, rawKey: string): Promise<CredentialMetadata> {
    const allowedProvider = providerName(provider);
    if (!sessionId || typeof rawKey !== "string" || rawKey.trim().length < 8) throw new Error("유효한 API 키와 세션이 필요합니다.");
    const key = scopedKey(sessionId, allowedProvider);
    const hint = maskedHint(rawKey);
    if (!this.masterKey) {
      this.db.prepare("DELETE FROM encrypted_credentials WHERE session_id=? AND provider=?").run(sessionId, allowedProvider);
      this.memory.set(key, { raw: rawKey, maskedHint: hint });
      return { provider: allowedProvider, saved: true, storage: "memory", maskedHint: hint };
    }
    const encrypted = encryptCredential(this.masterKey, rawKey, credentialContext(sessionId, allowedProvider));
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO encrypted_credentials(session_id,provider,ciphertext,iv,tag,masked_hint,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(session_id,provider) DO UPDATE SET ciphertext=excluded.ciphertext,iv=excluded.iv,tag=excluded.tag,masked_hint=excluded.masked_hint,updated_at=excluded.updated_at")
      .run(sessionId, allowedProvider, encrypted.ciphertext, encrypted.iv, encrypted.tag, hint, now, now);
    this.memory.delete(key);
    return { provider: allowedProvider, saved: true, storage: "encrypted", maskedHint: hint };
  }

  async getCredentialForProvider(sessionId: string, provider: ProviderId): Promise<string | null> {
    const allowedProvider = providerName(provider);
    const memory = this.memory.get(scopedKey(sessionId, allowedProvider));
    if (memory) return memory.raw;
    const row = this.db.prepare("SELECT ciphertext,iv,tag,masked_hint FROM encrypted_credentials WHERE session_id=? AND provider=?")
      .get(sessionId, allowedProvider) as CredentialRow | undefined;
    if (!row) return null;
    if (!this.masterKey) throw new Error("저장된 자격 증명을 읽을 암호화 키가 없습니다.");
    return decryptCredential(this.masterKey, row, credentialContext(sessionId, allowedProvider));
  }

  getMetadata(sessionId: string, provider: ProviderId): CredentialMetadata {
    const allowedProvider = providerName(provider);
    const memory = this.memory.get(scopedKey(sessionId, allowedProvider));
    if (memory) return { provider: allowedProvider, saved: true, storage: "memory", maskedHint: memory.maskedHint };
    const row = this.db.prepare("SELECT masked_hint FROM encrypted_credentials WHERE session_id=? AND provider=?")
      .get(sessionId, allowedProvider) as Pick<CredentialRow, "masked_hint"> | undefined;
    return row ? { provider: allowedProvider, saved: true, storage: "encrypted", maskedHint: row.masked_hint } :
      { provider: allowedProvider, saved: false, storage: "none", maskedHint: null };
  }

  async deleteCredential(sessionId: string, provider: ProviderId): Promise<void> {
    const allowedProvider = providerName(provider);
    this.memory.delete(scopedKey(sessionId, allowedProvider));
    this.db.prepare("DELETE FROM encrypted_credentials WHERE session_id=? AND provider=?").run(sessionId, allowedProvider);
  }
}
