import { afterEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { openDatabase } from "../../lib/db";
import { runMigrations } from "../../lib/db/migrate";
import { CredentialStore } from "../../lib/providers/credentials";

const opened: ReturnType<typeof openDatabase>[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); });
function setup(masterKey?: string) {
  const db = openDatabase({ dataDir: "unused", dbPath: ":memory:", demoAuth: true, maxUploadMb: 25 });
  opened.push(db); runMigrations(db);
  return { db, store: new CredentialStore(db, masterKey) };
}
const raw = "sk-actflow-test-secret-0123456789";
describe("session-scoped BYOK storage", () => {
  it.each([["session-two", "nebius"]] as const)("rejects ciphertext moved to %s / %s", async (session, provider) => {
    const { db, store } = setup(randomBytes(32).toString("hex"));
    await store.saveCredential("session-one", "nebius", raw);
    db.prepare("UPDATE encrypted_credentials SET session_id=?,provider=? WHERE session_id='session-one' AND provider='nebius'").run(session, provider);
    await expect(store.getCredentialForProvider(session, provider)).rejects.toThrow("복호화");
  });
  it("persists only ciphertext and returns masked metadata", async () => {
    const { db, store } = setup(randomBytes(32).toString("hex"));
    const metadata = await store.saveCredential("session-one", "nebius", raw);
    expect(metadata).toMatchObject({ provider: "nebius", saved: true, storage: "encrypted" });
    expect(metadata.maskedHint).toMatch(/•{4}6789/);
    expect(JSON.stringify(metadata)).not.toContain(raw);
    expect(await store.getCredentialForProvider("session-one", "nebius")).toBe(raw);
    expect(await store.getCredentialForProvider("session-two", "nebius")).toBeNull();
    const row = db.prepare("SELECT * FROM encrypted_credentials").get();
    expect(JSON.stringify(row)).not.toContain(raw);
    expect(JSON.stringify(db.prepare("SELECT * FROM recorder_events").all())).not.toContain(raw);
    await store.deleteCredential("session-one", "nebius");
    expect(await store.getCredentialForProvider("session-one", "nebius")).toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS count FROM encrypted_credentials").get()).toMatchObject({ count: 0 });
  });
  it("uses explicitly memory-only handling without a master key", async () => {
    const { db, store } = setup();
    const metadata = await store.saveCredential("session-one", "nebius", raw);
    expect(metadata.storage).toBe("memory");
    expect(db.prepare("SELECT COUNT(*) AS count FROM encrypted_credentials").get()).toMatchObject({ count: 0 });
    expect(await new CredentialStore(db).getCredentialForProvider("session-one", "nebius")).toBe(raw);
    await store.deleteCredential("session-one", "nebius");
    expect(await store.getCredentialForProvider("session-one", "nebius")).toBeNull();
  });
  it("reports key and decryption errors without secret material", async () => {
    const { db, store } = setup(randomBytes(32).toString("hex"));
    await store.saveCredential("session", "nebius", raw);
    const wrong = new CredentialStore(db, randomBytes(32).toString("hex"));
    let error: unknown;
    try { await wrong.getCredentialForProvider("session", "nebius"); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(raw);
    expect(String(error)).not.toContain("6789");
    expect(() => new CredentialStore(db, "bad-master-key")).toThrow();
  });
});
