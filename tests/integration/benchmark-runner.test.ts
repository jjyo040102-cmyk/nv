import { afterEach, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { runBenchmark } from "../../lib/benchmark/runner";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => { if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe cleanup"); rmSync(root, { recursive: true, force: true }); }));
it("executes both modes with physical file verification and observed rollback", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "actflow-benchmark-")); roots.push(root);
  const report = await runBenchmark({ runs: 2, provider: "demo", model: "actflow-demo-v1", rootDir: root });
  expect(report.rawRuns).toHaveLength(4);
  for (const run of report.rawRuns) {
    expect(run.completed).toBe(true); expect(run.extractionPassed).toBe(true); expect(run.realModelCalled).toBe(false);
    expect(run.analyzeLatencyMs).toBeGreaterThan(0); expect(run.approvalToResultMs).toBeGreaterThan(0);
    expect(run.verificationPassed).toBe(true); expect(run.artifacts).toHaveLength(2);
    for (const artifact of run.artifacts) { expect(artifact.physicallyVerified).toBe(true); expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/); expect(existsSync(artifact.path)).toBe(true); }
    expect(run.rollbackPassed).toBe(true); expect(run.rollback.deleted).toHaveLength(2); expect(run.rollback.remainingFiles).toHaveLength(0);
    for (const file of run.rollback.deleted) expect(existsSync(file)).toBe(false);
  }
});
it("requires an explicit real-provider opt-in and a key before network work", async () => {
  await expect(runBenchmark({ runs: 20, provider: "nebius", model: "gpt-6-astra" })).rejects.toThrow(/opt-in/i);
  await expect(runBenchmark({ runs: 20, provider: "nebius", model: "gpt-6-astra", allowReal: true })).rejects.toThrow(/key/i);
});
