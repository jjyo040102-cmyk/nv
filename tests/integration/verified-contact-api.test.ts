import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../lib/db";
import { runMigrations } from "../../lib/db/migrate";
import { VerifiedContactRepository } from "../../lib/email/verified-contacts";

const dbs: Database.Database[] = [];
afterEach(() => dbs.splice(0).forEach(db => db.close()));
function setup() {
  const db = openDatabase({ dataDir: ".", dbPath: ":memory:", demoAuth: true, maxUploadMb: 25 });
  dbs.push(db); runMigrations(db);
  return new VerifiedContactRepository(db);
}

describe("verified contacts", () => {
  it("stores an exact address and deterministically updates the same exact address", () => {
    const repo = setup();
    const first = repo.upsert({ ownerSessionId: "a", emailAddress: "User.Name@gmail.com", displayName: "First", autoReplyEnabled: true });
    const second = repo.upsert({ ownerSessionId: "a", emailAddress: "User.Name@gmail.com", displayName: "Updated", autoReplyEnabled: false });
    expect(second.id).toBe(first.id);
    expect(second.emailAddress).toBe("User.Name@gmail.com");
    expect(second.displayName).toBe("Updated");
    expect(second.autoReplyEnabled).toBe(false);
    expect(repo.list("a")).toHaveLength(1);
  });

  it("never treats aliases, local-part case changes, or another owner as the same verified contact", () => {
    const repo = setup();
    repo.upsert({ ownerSessionId: "a", emailAddress: "User.Name@gmail.com", autoReplyEnabled: true });
    expect(repo.findExact("a", "User.Name+tag@gmail.com")).toBeNull();
    expect(repo.findExact("a", "user.Name@gmail.com")).toBeNull();
    expect(repo.findExact("b", "User.Name@gmail.com")).toBeNull();
  });

  it("enforces ownership on update and delete", () => {
    const repo = setup();
    const contact = repo.upsert({ ownerSessionId: "a", emailAddress: "person@example.com", autoReplyEnabled: true });
    expect(() => repo.update(contact.id, "b", { autoReplyEnabled: false })).toThrow(/not found/i);
    expect(repo.remove(contact.id, "b")).toBe(false);
    expect(repo.remove(contact.id, "a")).toBe(true);
  });
});
