import { describe, expect, it } from "vitest";
import { percentile, summarizeBenchmark, type BenchmarkRun } from "../../lib/benchmark/report";
const sample = (iteration: number, mode: BenchmarkRun["mode"], latency: number, passed = true): BenchmarkRun => ({
  iteration, mode, workflowId: "measured", analyzeLatencyMs: latency, approvalToResultMs: latency,
  extractionPassed: passed, toolAttempts: 4, toolSucceeded: passed ? 4 : 2, verificationPassed: passed,
  rollbackPassed: passed, completed: passed, noExternalSideEffect: true, realModelCalled: false,
  artifacts: [], rollback: { deleted: [], remainingFiles: [] }, errors: []
});
describe("measured benchmark reports", () => {
  it("uses observed nearest-rank percentiles and never invents an empty measurement", () => {
    expect(percentile([], .5)).toBeNull(); expect(percentile([9, 1, 3, 5], .5)).toBe(3); expect(percentile([9, 1, 3, 5], .95)).toBe(9);
  });
  it("derives rates from raw outcomes and allows pre-execution to be slower", () => {
    const raw = [sample(0, "MANUAL", 10), sample(1, "MANUAL", 20, false), sample(0, "PRE_EXECUTION", 30), sample(1, "PRE_EXECUTION", 40)];
    const report = summarizeBenchmark({ provider: "demo", model: "actflow-demo-v1", effort: "default", runs: 2 }, raw);
    expect(report.rawRuns).toEqual(raw); expect(report.modes.MANUAL.sampleCount).toBe(2);
    expect(report.modes.MANUAL.taskExtractionPassRate).toBe(.5); expect(report.modes.MANUAL.toolSuccessRate).toBe(.75);
    expect(report.modes.MANUAL.verificationPassRate).toBe(.5); expect(report.modes.MANUAL.rollbackPassRate).toBe(.5);
    expect(report.preExecutionSavedMsP50).toBe(-20);
  });
  it("rejects reports whose raw sample count does not match the declared runs", () => {
    expect(() => summarizeBenchmark({ provider: "demo", model: "actflow-demo-v1", runs: 20 }, [sample(0, "MANUAL", 1)])).toThrow();
  });
});
