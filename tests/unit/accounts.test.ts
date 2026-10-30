import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../lib/db/migrate";
import { AccountService } from "../../lib/auth/accounts";
import { assertSameOrigin } from "../../lib/security/request-origin";
const databases: Database.Database[] = [];
const setup = () => { const db = new Database(":memory:"); databases.push(db); runMigrations(db); return { db, accounts: new AccountService(db) }; };
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
describe("operator-created accounts", () => {
  it("persists ownership across sessions without storing password or session token", async () => {
    const { db, accounts } = setup();
    const user = await accounts.create({ username: "judge", password: "review-access-password", workspaceId: "judge-workspace" });
    const first = await accounts.login("judge", "review-access-password");
    const second = await accounts.login("JUDGE", "review-access-password");
    expect(first.token).not.toBe(second.token);
    expect(accounts.resolve(first.token)).toEqual({ id: user.id, role: "APPROVER", sessionId: "judge-workspace" });
    const rows = JSON.stringify([db.prepare("SELECT * FROM app_users").all(), db.prepare("SELECT * FROM app_sessions").all()]);
    expect(rows).not.toContain("review-access-password"); expect(rows).not.toContain(first.token);
    accounts.logout(first.token); expect(accounts.resolve(first.token)).toBeNull(); expect(accounts.resolve(second.token)).not.toBeNull();
  });
  it("rejects expired sessions and disabled accounts", async () => {
    const { db, accounts } = setup();
    await accounts.create({ username: "worker", password: "long-enough-secret", role: "USER" });
    const session = await accounts.login("worker", "long-enough-secret", new Date("2026-10-11T00:00:00Z"));
    expect(accounts.resolve(session.token, new Date("2026-10-11T13:00:00Z"))).toBeNull();
    db.prepare("UPDATE app_users SET disabled=1").run();
    expect(accounts.resolve(session.token, new Date("2026-10-11T01:00:00Z"))).toBeNull();
  });
  it("limits incorrect password attempts and does not leak account existence", async () => {
    const { accounts } = setup();
    for (let i = 0; i < 8; i++) await expect(accounts.login("unknown", "bad")).rejects.toMatchObject({ status: 401 });
    await expect(accounts.login("unknown", "bad")).rejects.toMatchObject({ status: 429 });
  });
  it("rejects cross-site login/logout requests", () => {
    expect(() => assertSameOrigin(new Request("https://actflow.example/api/auth/login", { method: "POST", headers: { origin: "https://evil.example" } }))).toThrow();
    expect(() => assertSameOrigin(new Request("https://actflow.example/api/auth/login", { method: "POST", headers: { origin: "https://actflow.example" } }))).not.toThrow();
  });
});
