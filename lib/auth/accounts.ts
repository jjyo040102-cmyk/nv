import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type Database from "better-sqlite3";
import type { SessionActor } from "../domain/types";
import { ApiError } from "../api/responses";

const derive = promisify(scrypt);
const SESSION_MS = 12 * 60 * 60 * 1000;
const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");
const normalize = (value: string) => value.trim().toLowerCase();
const failure = () => new ApiError(401, "아이디 또는 비밀번호를 확인하세요.");

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 256) throw new Error("비밀번호는 12~256자로 정하세요.");
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${((await derive(password, salt, 64)) as Buffer).toString("hex")}`;
}
async function matches(password: string, encoded: string): Promise<boolean> {
  const [, salt, hash] = encoded.split(":");
  if (!/^[a-f0-9]{32}$/.test(salt ?? "") || !/^[a-f0-9]{128}$/.test(hash ?? "")) return false;
  const candidate = await derive(password, salt, 64) as Buffer;
  return timingSafeEqual(candidate, Buffer.from(hash, "hex"));
}

export class AccountService {
  constructor(private readonly db: Database.Database) {}
  async create(input: { username: string; password: string; role?: SessionActor["role"]; workspaceId?: string }): Promise<{ id: string; workspaceId: string }> {
    const username = normalize(input.username);
    if (!/^[a-z0-9][a-z0-9@._+-]{2,100}$/.test(username)) throw new Error("아이디는 영문·숫자 3~101자로 정하세요.");
    if (input.workspaceId && !/^[a-zA-Z0-9_-]{3,100}$/.test(input.workspaceId)) throw new Error("잘못된 작업 공간입니다.");
    const passwordHash = await hashPassword(input.password);
    const id = randomUUID(), workspaceId = input.workspaceId ?? randomUUID();
    this.db.prepare("INSERT INTO app_users(id,username,password_hash,workspace_id,role,created_at) VALUES (?,?,?,?,?,?)")
      .run(id, username, passwordHash, workspaceId, input.role ?? "APPROVER", new Date().toISOString());
    return { id, workspaceId };
  }
  async login(username: string, password: string, now = new Date()): Promise<{ token: string; actor: SessionActor; expiresAt: string }> {
    if (password.length > 256 || username.length > 101) throw failure();
    const bucket = hashToken(normalize(username));
    const windowMs = 15 * 60 * 1000;
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM login_attempts WHERE window_start < ?").run(new Date(now.getTime() - windowMs).toISOString());
      this.db.prepare("INSERT OR IGNORE INTO login_attempts(bucket,attempts,window_start) VALUES ('global',0,?)").run(now.toISOString());
      const total = (this.db.prepare("SELECT attempts FROM login_attempts WHERE bucket='global'").get() as { attempts: number }).attempts;
      if (total >= 240) throw new ApiError(429, "로그인 요청이 많습니다. 잠시 뒤 다시 시도하세요.");
      this.db.prepare("INSERT OR IGNORE INTO login_attempts(bucket,attempts,window_start) VALUES (?,0,?)").run(bucket, now.toISOString());
      const attempts = (this.db.prepare("SELECT attempts FROM login_attempts WHERE bucket=?").get(bucket) as { attempts: number }).attempts;
      if (attempts >= 8) throw new ApiError(429, "로그인 시도가 많습니다. 15분 뒤 다시 시도하세요.");
      this.db.prepare("UPDATE login_attempts SET attempts=attempts+1 WHERE bucket=?").run(bucket);
      this.db.prepare("UPDATE login_attempts SET attempts=attempts+1 WHERE bucket='global'").run();
    })();
    const user = this.db.prepare("SELECT * FROM app_users WHERE username=?").get(normalize(username)) as { id: string; password_hash: string; workspace_id: string; role: SessionActor["role"]; disabled: number } | undefined;
    // Equal-cost missing-account check avoids a cheap username timing oracle.
    const valid = await matches(password, user?.password_hash ?? `scrypt:${"0".repeat(32)}:${"0".repeat(128)}`);
    if (!user || user.disabled || !valid) throw failure();
    const token = randomBytes(32).toString("base64url"), expiresAt = new Date(now.getTime() + SESSION_MS).toISOString();
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM login_attempts WHERE bucket=?").run(bucket);
      this.db.prepare("DELETE FROM app_sessions WHERE expires_at<=?").run(now.toISOString());
      this.db.prepare("INSERT INTO app_sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)").run(hashToken(token), user.id, expiresAt, now.toISOString());
    })();
    return { token, expiresAt, actor: { id: user.id, sessionId: user.workspace_id, role: user.role } };
  }
  resolve(token: string, now = new Date()): SessionActor | null {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const row = this.db.prepare("SELECT u.id,u.workspace_id,u.role FROM app_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0")
      .get(hashToken(token), now.toISOString()) as { id: string; workspace_id: string; role: SessionActor["role"] } | undefined;
    return row ? { id: row.id, sessionId: row.workspace_id, role: row.role } : null;
  }
  logout(token: string): void { this.db.prepare("DELETE FROM app_sessions WHERE token_hash=?").run(hashToken(token)); }
}
