import { describe, expect, it } from "vitest";
import { readConfig } from "../../lib/config";

describe("readConfig", () => {
  it("defaults to a local manual-friendly runtime", () => {
    const config = readConfig({});
    expect(config.dataDir).toBe("./data/runtime");
    expect(config.dbPath).toBe("./data/runtime/actflow.sqlite");
    expect(config.demoAuth).toBe(true);
    expect(config.maxUploadMb).toBe(25);
  });

  it("accepts explicit runtime locations and limits", () => {
    const config = readConfig({ ACTFLOW_DATA_DIR: "D:/actflow", ACTFLOW_DB_PATH: "D:/actflow/test.sqlite", ACTFLOW_DEMO_AUTH: "false", ACTFLOW_MAX_UPLOAD_MB: "8" });
    expect(config).toMatchObject({ dataDir: "D:/actflow", dbPath: "D:/actflow/test.sqlite", demoAuth: false, maxUploadMb: 8 });
  });

  it.each(["0", "-2", "abc"])("rejects invalid upload limit %s", value => {
    expect(() => readConfig({ ACTFLOW_MAX_UPLOAD_MB: value })).toThrow();
  });
});
