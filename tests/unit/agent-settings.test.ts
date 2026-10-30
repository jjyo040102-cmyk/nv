import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../lib/db";
import { runMigrations } from "../../lib/db/migrate";
import { SettingsRepository } from "../../lib/db/settings-repository";

const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function setup() { const db = openDatabase({ dataDir: ".", dbPath: ":memory:", demoAuth: true, maxUploadMb: 25 }); databases.push(db); runMigrations(db); return new SettingsRepository(db); }

describe("persistent agent settings", () => {
  it("uses explicit safe automation defaults", () => {
    expect(setup().getSettings()).toMatchObject({
      executionMode: "MANUAL",
      automationProfile: "SAFE",
      autoContinueEnabled: false,
      projectMemoryEnabled: true,
      emailTaskDetectionEnabled: true,
      autoLinkWorkEnabled: true,
      replanOnNewInfoEnabled: true,
      retryFailedStepsEnabled: true,
      securityLevel: "HIGH"
    });
  });

  it("round-trips new settings while legacy partial updates preserve them", () => {
    const repo = setup();
    repo.updateSettings({ automationProfile: "AUTOMATIC", autoContinueEnabled: true, securityLevel: "STANDARD" });
    repo.updateSettings({ model: "actflow-demo-v1" });
    expect(repo.getSettings()).toMatchObject({ automationProfile: "AUTOMATIC", autoContinueEnabled: true, securityLevel: "STANDARD", model: "actflow-demo-v1" });
  });
});
