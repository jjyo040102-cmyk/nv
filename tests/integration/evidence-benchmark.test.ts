import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { renderEvidenceReport, runEvidenceSuite } from "../../lib/benchmark/evidence";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe fixture cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});

it("measures distinct artifact failures and actual workflow cleanup without network access", async () => {
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden in offline evidence"));
  const root = mkdtempSync(resolve(tmpdir(), "actflow-evidence-")); roots.push(root);
  const report = await runEvidenceSuite(root);
  expect(network).not.toHaveBeenCalled();
  expect(report).toMatchObject({ execution: "synthetic-offline", modelCalls: 0, externalSends: 0, distinctCases: 24, repetitionsPerCase: 1 });
  expect(new Set([...report.artifacts, ...report.workflows].map(item => item.id)).size).toBe(24);
  expect(report.summary).toMatchObject({ passed: 24, failed: 0, validAccepted: 8, validCases: 8, falseArtifactAcceptances: 0, invalidCases: 12, workflowPassed: 4 });
  expect(report.summary.textOnlyFalseAcceptances).toBeGreaterThan(0);
  for (const row of report.artifacts) {
    expect(row.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.oracle.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(row.oracle.accepted).toBe(row.expectedAccept);
  }
  const tamper = report.workflows.find(item => item.id === "workflow-tampered-cleanup")!;
  expect(tamper.checks.bytesActuallyChanged).toBe(true);
  expect(tamper.artifacts.every(item => item.state === "DELETED" && !item.exists)).toBe(true);
  expect(renderEvidenceReport(report)).toContain("not a competitor");
  expect(renderEvidenceReport(report)).toContain("SYNTHETIC / OFFLINE");
}, 30000);
