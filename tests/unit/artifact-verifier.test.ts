import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { generateParticipantsXlsx } from "../../lib/artifacts/xlsxGenerator";
import { generateResponseDocx } from "../../lib/artifacts/docxGenerator";
import { verifyArtifact } from "../../lib/workflow/verifier";
import ExcelJS from "exceljs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) { if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected cleanup target"); rmSync(root, { recursive: true, force: true }); } });
function destination(name: string) { const root = mkdtempSync(resolve(tmpdir(), "actflow-verify-")); roots.push(root); return resolve(root, name); }

describe("physical artifact verifier", () => {
  it("reopens a valid XLSX, checks required content, and records its SHA-256", async () => {
    const path = destination("participants.xlsx");
    await generateParticipantsXlsx([{ id: "E001", name: "김민지", department: "인사팀", title: "대리", eligibleForTraining: true }], path);
    const result = await verifyArtifact({ path, kind: "xlsx", requiredTexts: ["김민지", "교육 대상"] });
    expect(result).toMatchObject({ passed: true, format: "xlsx", requiredFieldsPassed: true });
    expect(result.size).toBeGreaterThan(0);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rejects zero-byte and corrupted nonempty spreadsheets", async () => {
    const empty = destination("empty.xlsx");
    writeFileSync(empty, "");
    expect((await verifyArtifact({ path: empty, kind: "xlsx", requiredTexts: [] })).passed).toBe(false);
    const corrupt = destination("corrupt.xlsx");
    writeFileSync(corrupt, "this is not a ZIP archive");
    expect((await verifyArtifact({ path: corrupt, kind: "xlsx", requiredTexts: [] })).passed).toBe(false);
  });
  it("rejects corrupted DOCX and missing required text", async () => {
    const corrupt = destination("corrupt.docx");
    writeFileSync(corrupt, "not a DOCX archive");
    expect((await verifyArtifact({ path: corrupt, kind: "docx", requiredTexts: [] })).passed).toBe(false);
    const path = destination("response.docx");
    await generateResponseDocx({ title: "회신", recipient: "교육팀", body: "참석합니다.", participantCount: 1, expenseKrw: 0 }, path);
    expect((await verifyArtifact({ path, kind: "docx", requiredTexts: ["허위 문구"] })).passed).toBe(false);
    expect((await verifyArtifact({ path, kind: "docx", requiredTexts: ["참석합니다."] })).passed).toBe(true);
  });
  const rows = [{ id: "E001", name: "김민지", department: "인사팀", title: "대리", eligibleForTraining: true }];
  const rosterGoal = { type: "participants" as const, version: 1 as const, rows };
  it("records exact roster predicates against independently supplied source rows", async () => {
    const path = destination("participants.xlsx");
    await generateParticipantsXlsx(rows, path);
    const result = await verifyArtifact({ path, kind: "xlsx", requiredTexts: ["김민지"], goal: rosterGoal });
    expect(result.goalSatisfied).toBe(true);
    expect(result.evidence.goalHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.evidence.predicates?.every(predicate => predicate.passed)).toBe(true);
  });
  it.each(["memo", "wrong-id", "wrong-department", "duplicate", "formula", "extra-sheet"]) ("rejects a %s roster even though its required names are present", async change => {
    const path = destination("participants.xlsx");
    await generateParticipantsXlsx(rows, path);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path);
    const sheet = workbook.worksheets[0];
    if (change === "memo") { sheet.getCell("A1").value = "메모"; sheet.getCell("B1").value = "잘못된 값"; }
    if (change === "wrong-id") sheet.getCell("A2").value = "E003";
    if (change === "wrong-department") sheet.getCell("C2").value = "회계팀";
    if (change === "duplicate") sheet.addRow(["E001", "김민지", "인사팀", "대리", "예"]);
    if (change === "formula") sheet.getCell("C2").value = { formula: '"인사팀"', result: "인사팀" };
    if (change === "extra-sheet") workbook.addWorksheet("추가 자료").getCell("A1").value = "김민지";
    await workbook.xlsx.writeFile(path);
    const result = await verifyArtifact({ path, kind: "xlsx", requiredTexts: ["김민지"], goal: rosterGoal });
    expect(result.passed).toBe(false);
    expect(result.goalSatisfied).toBe(false);
  });
  it("rejects a response with the right title and recipient but wrong count and cost", async () => {
    const path = destination("response.docx");
    const expected = { title: "AI 교육 참석 회신", recipient: "교육 운영팀", body: "참석합니다.", participantCount: 1, expenseKrw: 180000 };
    await generateResponseDocx({ ...expected, participantCount: 9, expenseKrw: 900000 }, path);
    const result = await verifyArtifact({ path, kind: "docx", requiredTexts: [expected.title, expected.recipient], goal: { type: "response", version: 1, ...expected } });
    expect(result.passed).toBe(false);
    expect(result.goalSatisfied).toBe(false);
  });
});
