import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { generateParticipantsXlsx } from "../../lib/artifacts/xlsxGenerator";
import { generateResponseDocx } from "../../lib/artifacts/docxGenerator";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) { if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected cleanup target"); rmSync(root, { recursive: true, force: true }); } });
function destination(name: string) { const root = mkdtempSync(resolve(tmpdir(), "actflow-generate-")); roots.push(root); return resolve(root, name); }

describe("real artifact generation", () => {
  it("creates a readable participant workbook with only selected fields", async () => {
    const path = destination("participants.xlsx");
    await generateParticipantsXlsx([{ id: "E001", name: "김민지", department: "인사팀", title: "대리", eligibleForTraining: true }], path);
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(path);
    const sheet = book.worksheets[0];
    expect(sheet.getRow(1).values).toEqual([, "사번", "이름", "부서", "직책", "교육 대상"]);
    expect(sheet.getRow(2).values).toEqual([, "E001", "김민지", "인사팀", "대리", "예"]);
    expect(sheet.columnCount).toBe(5);
  });

  it("creates a readable Korean response document with the required decision", async () => {
    const path = destination("response.docx");
    await generateResponseDocx({ title: "교육 참석 회신", recipient: "교육 운영팀", body: "참석 대상자 1명의 명단을 첨부합니다.", participantCount: 1, expenseKrw: 180_000 }, path);
    const text = (await mammoth.extractRawText({ buffer: readFileSync(path) })).value;
    expect(text).toContain("교육 참석 회신");
    expect(text).toContain("교육 운영팀");
    expect(text).toContain("180,000원");
  });
});
