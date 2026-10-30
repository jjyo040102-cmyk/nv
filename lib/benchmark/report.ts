import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ProviderId } from "../domain/types";

export type BenchmarkRun = {
  iteration: number; mode: "MANUAL" | "PRE_EXECUTION"; workflowId: string;
  analyzeLatencyMs: number; approvalToResultMs: number | null;
  extractionPassed: boolean; toolAttempts: number; toolSucceeded: number;
  verificationPassed: boolean; rollbackPassed: boolean; completed: boolean;
  noExternalSideEffect: boolean; realModelCalled: boolean;
  artifacts: { id: string; path: string; sha256: string | null; byteSize: number; physicallyVerified: boolean }[];
  rollback: { deleted: string[]; remainingFiles: string[] }; errors: string[];
};
type Metadata = { provider: ProviderId; model: string; effort?: string; runs: number };
export type BenchmarkModeSummary = {
  sampleCount: number; analyzeLatencyP50Ms: number | null; analyzeLatencyP95Ms: number | null;
  approvalToResultP50Ms: number | null; taskExtractionPassRate: number; toolSuccessRate: number | null;
  verificationPassRate: number; rollbackPassRate: number; completionPassRate: number; noExternalSideEffectRate: number;
};
export type BenchmarkReport = Metadata & {
  generatedAt: string; clock: "performance.now"; timingBoundary: string;
  modes: Record<BenchmarkRun["mode"], BenchmarkModeSummary>; preExecutionSavedMsP50: number | null;
  rawRuns: BenchmarkRun[];
};
export function percentile(values: number[], quantile: number): number | null {
  if (quantile <= 0 || quantile > 1 || values.some(v => !Number.isFinite(v) || v < 0)) throw new Error("Invalid percentile measurement");
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * quantile) - 1];
}
export function summarizeBenchmark(metadata: Metadata, rawRuns: BenchmarkRun[]): BenchmarkReport {
  if (!Number.isInteger(metadata.runs) || metadata.runs < 1) throw new Error("Invalid run count");
  const summarize = (mode: BenchmarkRun["mode"]): BenchmarkModeSummary => {
    const runs = rawRuns.filter(run => run.mode === mode);
    if (runs.length !== metadata.runs || new Set(runs.map(r => r.iteration)).size !== metadata.runs) throw new Error("Raw sample count does not match declared runs");
    const rate = (key: "extractionPassed" | "verificationPassed" | "rollbackPassed" | "completed" | "noExternalSideEffect") => runs.filter(run => run[key]).length / runs.length;
    const attempts = runs.reduce((sum, run) => sum + run.toolAttempts, 0);
    return { sampleCount: runs.length, analyzeLatencyP50Ms: percentile(runs.map(r => r.analyzeLatencyMs), .5),
      analyzeLatencyP95Ms: percentile(runs.map(r => r.analyzeLatencyMs), .95), approvalToResultP50Ms: percentile(runs.flatMap(r => r.approvalToResultMs === null ? [] : [r.approvalToResultMs]), .5),
      taskExtractionPassRate: rate("extractionPassed"), toolSuccessRate: attempts ? runs.reduce((sum, r) => sum + r.toolSucceeded, 0) / attempts : null,
      verificationPassRate: rate("verificationPassed"), rollbackPassRate: rate("rollbackPassed"), completionPassRate: rate("completed"), noExternalSideEffectRate: rate("noExternalSideEffect") };
  };
  if (rawRuns.length !== metadata.runs * 2) throw new Error("Unexpected raw runs");
  const modes = { MANUAL: summarize("MANUAL"), PRE_EXECUTION: summarize("PRE_EXECUTION") };
  const manual = modes.MANUAL.approvalToResultP50Ms, pre = modes.PRE_EXECUTION.approvalToResultP50Ms;
  return { ...metadata, effort: metadata.effort ?? "default", generatedAt: new Date().toISOString(), clock: "performance.now",
    timingBoundary: "Approval request to committed, reopened, VERIFIED XLSX/DOCX; excludes human wait, later send confirmation and independent verification. Analyze has no cache. Rollback is a separate pre-executed rejection workflow per sample.",
    modes, preExecutionSavedMsP50: manual === null || pre === null ? null : manual - pre, rawRuns };
}
export function renderBenchmark(report: BenchmarkReport): string {
  const ms = (v: number | null) => v === null ? "N/A" : v.toFixed(2);
  const pct = (v: number | null) => v === null ? "N/A" : `${(v * 100).toFixed(1)}%`;
  const row = (label: string, key: keyof BenchmarkModeSummary, formatter = ms) => `| ${label} | ${formatter(report.modes.MANUAL[key])} | ${formatter(report.modes.PRE_EXECUTION[key])} |`;
  return `# ActFlow 실제 실행 벤치마크\n\n생성: ${report.generatedAt}\n\n제공자: ${report.provider} · 모델: ${report.model} · effort: ${report.effort} · 방식별 ${report.runs}회\n\n` +
    "| 측정 | 수동 | 선실행 ON |\n|---|---:|---:|\n" + [row("분석 p50 (ms)", "analyzeLatencyP50Ms"), row("분석 p95 (ms)", "analyzeLatencyP95Ms"), row("승인 → 검증된 결과 p50 (ms)", "approvalToResultP50Ms"),
      row("업무 추출 통과", "taskExtractionPassRate", pct), row("도구 성공", "toolSuccessRate", pct), row("물리 파일 검증 통과", "verificationPassRate", pct), row("실제 rollback 통과", "rollbackPassRate", pct), row("워크플로 완료", "completionPassRate", pct)].join("\n") +
    `\n\n승인 이후 시간 차이 p50: **${ms(report.preExecutionSavedMsP50)} ms** (수동 p50 − 선실행 p50). 음수이면 이 측정에서는 선실행이 더 느렸습니다.\n\n${report.timingBoundary}\n\n` +
    "Demo 결과는 이 샘플의 회귀 검증입니다. 일반 문서 이해 정확도나 실제 LLM 성능 점수가 아닙니다. 선실행의 파일 생성 시간은 승인 전에 지불합니다. 실행 순서는 회차마다 번갈아 배치합니다. 원자료 JSON의 각 회차와 실패를 함께 확인하세요.\n";
}
export async function writeBenchmarkReport(report: BenchmarkReport, directory: string): Promise<{ json: string; markdown: string }> {
  await mkdir(directory, { recursive: true });
  const stem = report.generatedAt.replace(/[:.]/g, "-");
  const paths = { json: resolve(directory, `${stem}.json`), markdown: resolve(directory, `${stem}.md`) };
  await writeFile(paths.json, JSON.stringify(report, null, 2), { flag: "wx" });
  await writeFile(paths.markdown, renderBenchmark(report), { flag: "wx" });
  return paths;
}
