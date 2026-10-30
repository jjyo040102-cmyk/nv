import { createHash, randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { ApiError } from "../api/responses";
import { encryptCredential, decryptCredential, type EncryptedSecret } from "../security/crypto";
import { normalizeEmailAddress } from "../events/email-normalizer";
import { googleRequest, type GoogleRequest } from "./google-http";
const scopes = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"];
type Tokens = { accessToken: string; refreshToken: string; expiresAt: number };
type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope?: string; token_type: string };
type Row = { owner_session_id: string; email_address: string; secret_json: string; version: number; enabled: number; watch_enabled: number; last_error: string | null; synced_at: string | null };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const refreshes = new WeakMap<Database.Database, Map<string, Promise<string>>>();

export class GmailConnection {
  constructor(private readonly db: Database.Database, private readonly masterKey: string | undefined, private readonly http: GoogleRequest = googleRequest) {}
  configured(): boolean { return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.ACTFLOW_PUBLIC_URL && this.masterKey && /^[a-f0-9]{64}$/i.test(this.masterKey)); }
  private config() {
    if (!this.configured()) throw new ApiError(409, "서버에 Google OAuth 연결 설정이 필요합니다. 설치 안내의 Gmail 설정을 완료하세요.");
    const base = new URL(process.env.ACTFLOW_PUBLIC_URL!);
    if (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))) throw new ApiError(409, "Gmail 연결에는 HTTPS 또는 localhost 주소가 필요합니다.");
    return { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET!, redirectUri: new URL("/api/connectors/gmail/callback", base).href };
  }
  private key(): Buffer { if (!this.masterKey || !/^[a-f0-9]{64}$/i.test(this.masterKey)) throw new ApiError(409, "지속 연결을 위한 암호화 키가 필요합니다."); return Buffer.from(this.masterKey, "hex"); }
  private row(owner: string): Row | null { return this.db.prepare("SELECT * FROM gmail_connections WHERE owner_session_id=?").get(owner) as Row | undefined ?? null; }
  status(owner: string) { const row = this.row(owner); return { configured: this.configured(), connected: row?.enabled === 1, email: row?.email_address ?? null, watching: row?.watch_enabled === 1, lastError: row?.last_error ?? null, syncedAt: row?.synced_at ?? null, realMailEnabled: process.env.ACTFLOW_REAL_MAIL_ENABLED === "true" }; }
  begin(owner: string, actorId: string): string {
    const config = this.config(), state = randomBytes(32).toString("base64url"), verifier = randomBytes(32).toString("base64url");
    this.db.prepare("DELETE FROM gmail_oauth_states WHERE expires_at<=?").run(new Date().toISOString());
    this.db.prepare("INSERT INTO gmail_oauth_states(state_hash,owner_session_id,actor_id,verifier,expires_at) VALUES (?,?,?,?,?)")
      .run(hash(state), owner, actorId, verifier, new Date(Date.now() + 10 * 60 * 1000).toISOString());
    const query = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code", scope: scopes.join(" "), access_type: "offline", prompt: "consent", state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" });
    return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
  }
  async finish(owner: string, actorId: string, state: string, code: string): Promise<void> {
    if (!/^[\w-]{43}$/.test(state) || !code || code.length > 4096) throw new ApiError(400, "잘못된 Gmail 연결 응답입니다.");
    const saved = this.db.prepare("DELETE FROM gmail_oauth_states WHERE state_hash=? AND owner_session_id=? AND actor_id=? AND expires_at>? RETURNING verifier")
      .get(hash(state), owner, actorId, new Date().toISOString()) as { verifier: string } | undefined;
    if (!saved) throw new ApiError(409, "Gmail 연결 요청이 만료됐습니다. 다시 연결하세요.");
    const config = this.config();
    const tokens = await this.exchange({ grant_type: "authorization_code", code, redirect_uri: config.redirectUri, code_verifier: saved.verifier });
    if (!tokens.refresh_token || !tokens.scope || !scopes.every(scope => tokens.scope!.split(" ").includes(scope))) throw new ApiError(409, "메일 읽기·보내기 권한을 모두 허용하고 다시 연결하세요.");
    const profile = await this.http<{ emailAddress: string }>("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { authorization: `Bearer ${tokens.access_token}` } });
    const email = normalizeEmailAddress(profile.emailAddress), now = new Date().toISOString();
    const encrypted = this.encode(owner, { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + tokens.expires_in * 1000 });
    this.db.prepare(`INSERT INTO gmail_connections(owner_session_id,email_address,secret_json,created_at,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(owner_session_id) DO UPDATE SET email_address=excluded.email_address,secret_json=excluded.secret_json,version=gmail_connections.version+1,enabled=1,watch_enabled=0,last_error=NULL,synced_at=NULL,updated_at=excluded.updated_at`)
      .run(owner, email, encrypted, now, now);
  }
  private encode(owner: string, tokens: Tokens): string { return JSON.stringify(encryptCredential(this.key(), JSON.stringify(tokens), `gmail:${owner}`)); }
  private decode(row: Row): Tokens { return JSON.parse(decryptCredential(this.key(), JSON.parse(row.secret_json) as EncryptedSecret, `gmail:${row.owner_session_id}`)) as Tokens; }
  private async exchange(values: Record<string, string>): Promise<TokenResponse> {
    const config = this.config();
    const response = await this.http<TokenResponse>("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...values, client_id: config.clientId, client_secret: config.clientSecret }).toString() });
    if (!response.access_token || response.access_token.length > 8192 || !Number.isFinite(response.expires_in) || response.expires_in <= 0 || response.token_type?.toLowerCase() !== "bearer") throw new ApiError(502, "Gmail 인증 응답을 확인하지 못했습니다.");
    return response;
  }
  async accessToken(owner: string): Promise<string> {
    const row = this.row(owner); if (!row || !row.enabled) throw new ApiError(409, "설정에서 Gmail 계정을 연결하세요.");
    const tokens = this.decode(row); if (tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;
    let pending = refreshes.get(this.db); if (!pending) { pending = new Map(); refreshes.set(this.db, pending); }
    const active = pending.get(owner); if (active) return active;
    const operation = (async () => {
      try {
        const refreshed = await this.exchange({ grant_type: "refresh_token", refresh_token: tokens.refreshToken });
        const encoded = this.encode(owner, { accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token ?? tokens.refreshToken, expiresAt: Date.now() + refreshed.expires_in * 1000 });
        if (this.db.prepare("UPDATE gmail_connections SET secret_json=?,version=version+1,last_error=NULL,updated_at=? WHERE owner_session_id=? AND version=? AND secret_json=? AND enabled=1")
          .run(encoded, new Date().toISOString(), owner, row.version,row.secret_json).changes !== 1) throw new ApiError(409, "Gmail 연결이 변경됐습니다. 다시 시도하세요.");
        return refreshed.access_token;
      } catch (error) { this.db.prepare("UPDATE gmail_connections SET last_error=? WHERE owner_session_id=? AND version=? AND secret_json=?").run("Gmail 인증 갱신에 실패했습니다. 다시 연결하세요.", owner, row.version,row.secret_json); throw error; }
      finally { pending!.delete(owner); }
    })(); pending.set(owner, operation); return operation;
  }
  email(owner: string): string { const row = this.row(owner); if (!row?.enabled) throw new ApiError(409, "Gmail 연결이 필요합니다."); return row.email_address; }
  disconnect(owner: string): void {
    this.db.transaction(() => { this.db.prepare("DELETE FROM gmail_connections WHERE owner_session_id=?").run(owner); this.db.prepare("DELETE FROM gmail_oauth_states WHERE owner_session_id=?").run(owner); })();
  }
  watch(owner: string, enabled: boolean): void {
    if (this.db.prepare("UPDATE gmail_connections SET watch_enabled=?,updated_at=? WHERE owner_session_id=? AND enabled=1").run(Number(enabled), new Date().toISOString(), owner).changes !== 1) throw new ApiError(409, "Gmail 연결이 필요합니다.");
  }
}
