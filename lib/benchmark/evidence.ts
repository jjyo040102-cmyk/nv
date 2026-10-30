import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import ExcelJS from "exceljs";
import { buildParticipantsXlsxBytes, type ParticipantRow } from "../artifacts/xlsxGenerator";
import { buildResponseDocxBytes, type ResponseDocumentInput } from "../artifacts/docxGenerator";
import { openDatabase } from "../db";
import { runMigrations } from "../db/migrate";
import { WorkflowRepository } from "../db/repository";
import { DemoProvider, OFFICIAL_DEMO_TEXT } from "../providers/demo";
import { WorkflowEngine } from "../workflow/engine";
import { verifyArtifact, type ArtifactGoal } from "../workflow/verifier";
import { inspectEvidenceArtifact, type OracleResult } from "./evidence-oracle";

type ArtifactCase = { id: string; label: string; expectedAccept: boolean; goal: ArtifactGoal; mutate?: (bytes: Buffer) => Promise<Buffer> };
export type ArtifactEvidence = {
  id: string; label: string; category: "valid" | "invalid"; inputHash: string; expectedGoal: ArtifactGoal; artifact: string; elapsedMs: number;
  expectedAccept: boolean; oracle: OracleResult; goalVerifierAccepted: boolean; textOnlyAccepted: boolean;
  failedPredicates: string[]; passed: boolean;
};
export type WorkflowEvidence = {
  id: string; mode: "MANUAL" | "PRE_EXECUTION"; workflowId: string; inputHash: string; elapsedMs: number;
  expected: string; status: string; errorCode: string | null; checks: Record<string, boolean>; passed: boolean;
  artifacts: Array<{ path: string; state: string; exists: boolean; sha256: string | null; oracle?: OracleResult }>;
  eventTypes: string[]; verificationEvidence: Array<{ status: string | null; details: unknown }>;
  tamperEvidence: { originalHash: string | null; changedHash: string | null } | null;
};
export type EvidenceReport = {
  schema: "actflow-offline-evidence-v1"; generatedAt: string; suiteVersion: 1; execution: "synthetic-offline";
  modelCalls: 0; externalSends: 0; distinctCases: number; repetitionsPerCase: 1;
  workflowFixture: { sourceText: string; expectedParticipants: ParticipantRow[]; expectedResponse: ResponseDocumentInput };
  scope: string[]; artifacts: ArtifactEvidence[]; workflows: WorkflowEvidence[];
  summary: { passed: number; failed: number; validAccepted: number; validCases: number; falseArtifactAcceptances: number; invalidCases: number; textOnlyFalseAcceptances: number; workflowPassed: number; workflowCases: number };
};
const participants: ParticipantRow[] = [
  { id: "E001", name: "김민지", department: "인사팀", title: "대리", eligibleForTraining: true },
  { id: "E002", name: "이준호", department: "개발팀", title: "과장", eligibleForTraining: true }
];
const response: ResponseDocumentInput = { title: "AI 교육 참석 회신", recipient: "교육 운영팀", body: "AI 교육 참가 대상자 명단을 제출합니다.", participantCount: 2, expenseKrw: 180000 };
const rosterGoal = (rows = participants): ArtifactGoal => ({ type: "participants", version: 1, rows });
const responseGoal = (input = response): ArtifactGoal => ({ type: "response", version: 1, ...input });
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function changeSpreadsheet(bytes: Buffer, edit: (sheet: ExcelJS.Worksheet, workbook: ExcelJS.Workbook) => void): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
  edit(workbook.worksheets[0], workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
function artifactCases(): ArtifactCase[] {
  const valid: ArtifactCase[] = [
    { id: "valid-roster-one", label: "One eligible participant", expectedAccept: true, goal: rosterGoal(participants.slice(0, 1)) },
    { id: "valid-roster-two", label: "Two eligible participants", expectedAccept: true, goal: rosterGoal() },
    { id: "valid-roster-reordered", label: "Permitted row order change", expectedAccept: true, goal: rosterGoal(), mutate: () => buildParticipantsXlsxBytes([...participants].reverse()) },
    { id: "valid-roster-unicode", label: "Unicode and XML-sensitive names", expectedAccept: true, goal: rosterGoal([{ ...participants[0], name: "Ana & 민지 <QA>", department: "R&D" }]) },
    { id: "valid-response-standard", label: "Two-person response with expense", expectedAccept: true, goal: responseGoal() },
    { id: "valid-response-zero-cost", label: "Zero-cost response", expectedAccept: true, goal: responseGoal({ ...response, expenseKrw: 0 }) },
    { id: "valid-response-one", label: "One-person response", expectedAccept: true, goal: responseGoal({ ...response, participantCount: 1 }) },
    { id: "valid-response-unicode", label: "XML-sensitive response body", expectedAccept: true, goal: responseGoal({ ...response, body: 'R&D <교육> "참석" 확인 & 제출합니다.' }) }
  ];
  const mutations: Array<[string, string, (sheet: ExcelJS.Worksheet, workbook: ExcelJS.Workbook) => void]> = [
    ["missing-header", "Required name present but header replaced", sheet => { sheet.getCell("A1").value = "메모"; }],
    ["wrong-id", "Correct name paired with wrong employee ID", sheet => { sheet.getCell("A2").value = "E999"; }],
    ["wrong-department", "Correct name paired with wrong department", sheet => { sheet.getCell("C2").value = "재무팀"; }],
    ["duplicate", "Duplicate participant row", sheet => { sheet.addRow(["E001", "김민지", "인사팀", "대리", "예"]); }],
    ["formula", "Formula masquerades as a literal source value", sheet => { sheet.getCell("C2").value = { formula: '"인사팀"', result: "인사팀" }; }],
    ["extra-sheet", "Unapproved extra sheet", (_, workbook) => { workbook.addWorksheet("첨부 정보").getCell("A1").value = "unapproved"; }],
    ["hidden-row", "Required participant row is hidden", sheet => { sheet.getRow(2).hidden = true; }],
    ["private-column", "Unapproved private-data column", sheet => { sheet.getCell("F1").value = "계좌"; sheet.getCell("F2").value = "DUMMY-PRIVATE-001"; }]
  ];
  return [...valid, ...mutations.map(([id, label, edit]) => ({ id: `invalid-roster-${id}`, label, expectedAccept: false, goal: rosterGoal(), mutate: (bytes: Buffer) => changeSpreadsheet(bytes, edit) })),
    ...([
      ["count", "Wrong response participant count", { participantCount: 9 }],
      ["cost", "Wrong response expense", { expenseKrw: 900000 }],
      ["recipient", "Wrong response recipient", { recipient: "다른 운영팀" }],
      ["body", "Unsupported promise in response body", { body: "모든 참가비를 이미 납부했습니다." }]
    ] as Array<[string, string, Partial<ResponseDocumentInput>]>).map(([id, label, changes]) => ({ id: `invalid-response-${id}`, label, expectedAccept: false, goal: responseGoal(), mutate: () => buildResponseDocxBytes({ ...response, ...changes }) }))];
}

async function runArtifactCase(test: ArtifactCase, root: string): Promise<ArtifactEvidence> {
  const start = performance.now();
  const kind = test.goal.type === "participants" ? "xlsx" : "docx";
  const path = resolve(root, `${test.id}.${kind}`);
  let bytes = test.goal.type === "participants" ? await buildParticipantsXlsxBytes(test.goal.rows) : await buildResponseDocxBytes(test.goal);
  if (test.mutate) bytes = await test.mutate(bytes);
  await writeFile(path, bytes, { flag: "wx" });
  const oracle = await inspectEvidenceArtifact(path, test.goal);
  const requiredTexts = test.goal.type === "participants" ? test.goal.rows.map(row => row.name) : [test.goal.title];
  const gated = await verifyArtifact({ path, kind, requiredTexts, goal: test.goal });
  const textOnly = await verifyArtifact({ path, kind, requiredTexts });
  return { id: test.id, label: test.label, category: test.expectedAccept ? "valid" : "invalid", inputHash: hash({ id: test.id, goal: test.goal }), expectedGoal: test.goal, artifact: relative(root, path), elapsedMs: performance.now() - start,
    expectedAccept: test.expectedAccept, oracle, goalVerifierAccepted: gated.passed, textOnlyAccepted: textOnly.passed,
    failedPredicates: gated.evidence.predicates?.filter(item => !item.passed).map(item => item.id) ?? [],
    passed: oracle.accepted === test.expectedAccept && gated.passed === oracle.accepted };
}

async function runWorkflowCase(id: string, mode: "MANUAL" | "PRE_EXECUTION", action: "complete" | "reject" | "tamper", root: string): Promise<WorkflowEvidence> {
  const started = performance.now();
  const directory = resolve(root, id);
  const db = openDatabase({ dataDir: directory, dbPath: resolve(directory, "actflow.sqlite"), demoAuth: true, maxUploadMb: 25 });
  const actor = { id: "demo-user", sessionId: "actflow-local-demo", role: "USER" as const };
  const approver = { ...actor, id: "demo-approver", role: "APPROVER" as const };
  try {
    runMigrations(db);
    const repo = new WorkflowRepository(db), engine = new WorkflowEngine(db, directory);
    const workflow = repo.createWorkflow({ sourceName: "synthetic-training-fixture.txt", sourceText: OFFICIAL_DEMO_TEXT, executionMode: mode, preExecutionEnabled: mode === "PRE_EXECUTION" });
    await engine.analyzeWorkflow(workflow.id, input => new DemoProvider().analyzeDocument({ text: input.sourceText, sourceName: input.sourceName }));
    const waiting = await engine.executeWorkflow(workflow.id, actor);
    const approval = waiting.approvals.find(item => item.kind === "APPROVAL" && item.status === "PENDING");
    if (!approval) throw new Error("Evidence fixture did not reach expense approval");
    const staged = waiting.artifacts.filter(item => item.state === "TEMPORARY");
    const stagedFilesExisted = staged.length === 2 && staged.every(item => existsSync(resolve(directory, item.relativePath)));
    let originalHash: string | null = null, tamperedHash: string | null = null;
    if (action === "tamper") {
      const file = staged.find(item => item.displayName.endsWith(".xlsx"));
      if (!file) throw new Error("Tamper fixture lacks staged XLSX");
      const path = resolve(directory, file.relativePath);
      originalHash = createHash("sha256").update(await readFile(path)).digest("hex");
      const bytes = await changeSpreadsheet(await readFile(path), sheet => { sheet.getCell("A2").value = "E999"; });
      await writeFile(path, bytes);
      tamperedHash = createHash("sha256").update(bytes).digest("hex");
    }
    // A failure is an observation. Only the final state and filesystem establish success below.
    try {
      const result = await engine.resolveApproval(approval.id, action === "reject" ? "REJECTED" : "APPROVED", approval.version, approver);
      if (action === "complete") {
        const confirm = result.approvals.find(item => item.kind === "CONFIRM" && item.status === "PENDING");
        if (!confirm) throw new Error("Evidence fixture lacks send confirmation");
        await engine.resolveApproval(confirm.id, "APPROVED", confirm.version, actor);
      }
    } catch (error) {
      if (action !== "tamper") throw error;
    }
    const result = engine.getSnapshot(workflow.id);
    const artifacts: WorkflowEvidence["artifacts"] = [];
    for (const artifact of result.artifacts) {
      const path = resolve(directory, artifact.relativePath), exists = existsSync(path);
      const oracle = exists && artifact.state === "COMMITTED" ? await inspectEvidenceArtifact(path, artifact.displayName.endsWith(".xlsx") ? rosterGoal() : responseGoal()) : undefined;
      artifacts.push({ path: relative(root, path), state: artifact.state, exists, sha256: artifact.sha256, oracle });
    }
    const checks: Record<string, boolean> = {
      noLiveModel: result.workflow.provider?.realModelCalled === false,
      noActualExternalEffect: result.events.every(event => event.externalEffect !== "ACTUAL")
    };
    if (action === "complete") {
      checks.completed = result.workflow.status === "COMPLETED";
      checks.committedFilesMatchIndependentOracle = artifacts.length === 2 && artifacts.every(item => item.state === "COMMITTED" && item.oracle?.accepted === true && item.oracle.sha256 === item.sha256);
    } else {
      checks.notCompleted = result.workflow.status !== "COMPLETED";
      checks.hadTwoPhysicalStagedFiles = stagedFilesExisted;
      checks.noPublishedArtifacts = artifacts.length === 2 && artifacts.every(item => item.state === "DELETED" && !item.exists);
      checks.originalStagedPathsRemoved = staged.every(item => !existsSync(resolve(directory, item.relativePath)));
      checks.rollbackRecorded = result.events.some(event => event.eventType === "ROLLBACK_COMPLETED");
      if (action === "reject") checks.rejectionRecorded = result.workflow.errorCode === "DECISION_REJECTED";
      else {
        checks.bytesActuallyChanged = !!originalHash && !!tamperedHash && originalHash !== tamperedHash;
        checks.verificationFailureRecorded = result.events.some(event => event.eventType === "VERIFICATION" && event.verificationStatus === "FAILED");
      }
    }
    return { id, mode, workflowId: workflow.id, inputHash: hash({ source: OFFICIAL_DEMO_TEXT, mode, action }), elapsedMs: performance.now() - started,
      expected: action === "complete" ? "Complete with two independently verified files" : "Stop and physically remove staged files", status: result.workflow.status,
      errorCode: result.workflow.errorCode, checks, passed: Object.values(checks).every(Boolean), artifacts, eventTypes: result.events.map(event => event.eventType),
      verificationEvidence: result.events.filter(event => event.eventType === "VERIFICATION").map(event => ({ status: event.verificationStatus ?? null, details: event.details ?? null })),
      tamperEvidence: action === "tamper" ? { originalHash, changedHash: tamperedHash } : null };
  } finally { db.close(); }
}

export async function runEvidenceSuite(root: string): Promise<EvidenceReport> {
  if (process.env.NODE_ENV === "production") throw new Error("Offline evidence suite must not run in production");
  await mkdir(root, { recursive: true });
  const artifacts: ArtifactEvidence[] = [], workflows: WorkflowEvidence[] = [];
  for (const test of artifactCases()) artifacts.push(await runArtifactCase(test, root));
  for (const [id, mode, action] of [
    ["workflow-manual-complete", "MANUAL", "complete"], ["workflow-preexecution-complete", "PRE_EXECUTION", "complete"],
    ["workflow-rejected-cleanup", "PRE_EXECUTION", "reject"], ["workflow-tampered-cleanup", "PRE_EXECUTION", "tamper"]
  ] as const) workflows.push(await runWorkflowCase(id, mode, action, root));
  const all = [...artifacts, ...workflows], valid = artifacts.filter(item => item.expectedAccept), invalid = artifacts.filter(item => !item.expectedAccept);
  return { schema: "actflow-offline-evidence-v1", generatedAt: new Date().toISOString(), suiteVersion: 1, execution: "synthetic-offline", modelCalls: 0, externalSends: 0,
    distinctCases: all.length, repetitionsPerCase: 1,
    workflowFixture: { sourceText: OFFICIAL_DEMO_TEXT, expectedParticipants: participants, expectedResponse: response },
    scope: ["20 deterministic artifact cases and 4 actual workflow-engine lifecycle cases; one run per case, not 24 user tasks.",
      "Independent assertion logic; XLSX shares ExcelJS with the production parser. DOCX oracle reads OOXML with JSZip instead of mammoth.",
      "Text-only ablation uses the same candidate bytes without goal predicates; it is not a competitor, model-quality, or general task-completion comparison.",
      "No Nebius, NVIDIA model, Gmail, user-effort, cost, or real-world success measurements. Durations are local processing only.",
      "Workflow scenarios use the bundled fixed training fixture solely for regression; they do not prove general request understanding or real delivery."],
    artifacts, workflows,
    summary: { passed: all.filter(item => item.passed).length, failed: all.filter(item => !item.passed).length,
      validAccepted: valid.filter(item => item.goalVerifierAccepted && item.oracle.accepted).length, validCases: valid.length,
      falseArtifactAcceptances: invalid.filter(item => item.goalVerifierAccepted && !item.oracle.accepted).length, invalidCases: invalid.length,
      textOnlyFalseAcceptances: invalid.filter(item => item.textOnlyAccepted && !item.oracle.accepted).length,
      workflowPassed: workflows.filter(item => item.passed).length, workflowCases: workflows.length } };
}

export function renderEvidenceReport(report: EvidenceReport): string {
  const s = report.summary;
  return `# ActFlow offline evidence report\n\nGenerated: ${report.generatedAt}\n\n**SYNTHETIC / OFFLINE — ${report.modelCalls} model calls; ${report.externalSends} external sends.**\n\n` +
    `Reproducible command: \`npx tsx scripts/benchmark-evidence.ts\`\n\n${report.distinctCases} distinct fixture cases, one execution each. Passed: **${s.passed}/${report.distinctCases}**.\n\n` +
    `| Measurement | Observed |\n|---|---:|\n| Valid artifacts accepted | ${s.validAccepted}/${s.validCases} |\n| Invalid artifacts accepted by goal verifier | ${s.falseArtifactAcceptances}/${s.invalidCases} |\n| Invalid artifacts accepted by text-only ablation | ${s.textOnlyFalseAcceptances}/${s.invalidCases} |\n| Workflow lifecycle checks passed | ${s.workflowPassed}/${s.workflowCases} |\n\n` +
    `## Artifact evidence\n\n| Case | Oracle | Goal verifier | Text-only | Result |\n|---|---|---|---|---|\n` +
    report.artifacts.map(item => `| ${item.id} | ${item.oracle.accepted ? "valid" : "invalid"} | ${item.goalVerifierAccepted ? "accept" : "reject"} | ${item.textOnlyAccepted ? "accept" : "reject"} | ${item.passed ? "PASS" : "FAIL"} |`).join("\n") +
    `\n\n## Workflow evidence\n\n| Case | Observed state | Physical artifacts | Result |\n|---|---|---|---|\n` +
    report.workflows.map(item => `| ${item.id} | ${item.status} | ${item.artifacts.map(artifact => `${artifact.state}/${artifact.exists ? "exists" : "absent"}`).join(", ")} | ${item.passed ? "PASS" : "FAIL"} |`).join("\n") +
    `\n\n## Interpretation and limits\n\n` + report.scope.map(item => `- ${item}`).join("\n") +
    "\n\nThe adjacent JSON retains input hashes, physical artifact hashes, separate oracle observations, failed predicates, workflow event types and per-check outcomes. Zero failures in this small constructed suite is not a general reliability guarantee.\n";
}

export async function writeEvidenceSuite(directory = resolve("data/runtime/evidence-benchmarks")): Promise<{ root: string; json: string; markdown: string; report: EvidenceReport }> {
  const root = resolve(directory, randomUUID());
  const report = await runEvidenceSuite(root);
  const json = resolve(root, "report.json"), markdown = resolve(root, "report.md");
  await writeFile(json, JSON.stringify(report, null, 2), { flag: "wx" });
  await writeFile(markdown, renderEvidenceReport(report), { flag: "wx" });
  return { root, json, markdown, report };
}
