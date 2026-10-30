import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => { if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe cleanup"); rmSync(root, { recursive: true, force: true }); }));
describe("portable local delivery", () => {
  it("provides both launchers with install, env initialization, migration, seed and loopback launch", () => {
    for (const path of ["start.bat", "start.sh"]) {
      const text = readFileSync(path, "utf8");
      for (const command of ["npm ci", "initialize-local-env.mjs", "db:migrate", "seed:demo", "open-browser.mjs", "npm run dev"]) expect(text).toContain(command);
      expect(text).toContain("127.0.0.1"); expect(text).not.toMatch(/[A-Z]:\\Users\\/i);
      expect(text.indexOf("db:migrate")).toBeLessThan(text.indexOf("seed:demo"));
    }
    expect(JSON.parse(readFileSync("package.json", "utf8")).engines.node).toBe("^22.22.2 || ^24.15.0 || >=26.0.0");
  });
  it("rejects runtime versions unsupported by the installed toolchain", async () => {
    const { isSupportedNode } = await import("../../scripts/check-runtime.mjs");
    for (const version of ["20.19.0", "22.0.0", "22.16.0", "22.22.1", "24.14.0", "25.0.0"]) expect(isSupportedNode(version)).toBe(false);
    for (const version of ["22.22.2", "22.23.0", "24.15.0", "24.18.0", "26.0.0"]) expect(isSupportedNode(version)).toBe(true);
  });
  it("generates distinct private keys once without overwriting existing local configuration", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "actflow-env-")); roots.push(root);
    const { initializeLocalEnv } = await import("../../scripts/initialize-local-env.mjs");
    await initializeLocalEnv(root); const first = readFileSync(resolve(root, ".env.local"), "utf8");
    const keys = first.match(/(?:MASTER_KEY|SESSION_SECRET)=([a-f0-9]{64})/g); expect(keys).toHaveLength(2); expect(keys![0].split("=")[1]).not.toBe(keys![1].split("=")[1]);
    await initializeLocalEnv(root); expect(readFileSync(resolve(root, ".env.local"), "utf8")).toBe(first);
  });
  it("ignores secrets, runtime data, WAL and benchmark measurements", () => {
    const root = mkdtempSync(resolve(tmpdir(), "actflow-gitignore-")); roots.push(root);
    writeFileSync(resolve(root, ".gitignore"), readFileSync(".gitignore"));
    execFileSync("git", ["init", "-q"], { cwd: root });
    const names = [".env", ".env.local", "data/runtime/actflow.sqlite", "data/runtime/actflow.sqlite-wal", "data/runtime/actflow.sqlite-shm", "data/runtime/benchmarks/result.json"];
    for (const path of names) expect(execFileSync("git", ["check-ignore", path], { encoding: "utf8", cwd: root }).trim()).toBe(path);
    expect(execFileSync("git", ["ls-files", ".env", ".env.local"], { encoding: "utf8", cwd: root }).trim()).toBe("");
  });
});
