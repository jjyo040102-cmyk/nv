import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import type { ArtifactGoal } from "../workflow/verifier";

export type OracleResult = { accepted: boolean; sha256: string; checks: Record<string, boolean>; observed: unknown };

/** Evaluation-only oracle. Never consumes the production verifier's verdict or predicates. */
export async function inspectEvidenceArtifact(path: string, expected: ArtifactGoal): Promise<OracleResult> {
  const bytes = await readFile(path);
  const checks: Record<string, boolean> = {};
  let observed: unknown = null;
  try {
    if (expected.type === "participants") {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      const sheet = workbook.getWorksheet("참석자 명단");
      checks.singleVisibleSheet = workbook.worksheets.length === 1 && !!sheet && sheet.state === "visible";
      if (sheet) {
        const headers = ["사번", "이름", "부서", "직책", "교육 대상"];
        const actual: unknown[][] = [];
        for (let row = 2; row <= sheet.rowCount; row++) actual.push(headers.map((_, column) => sheet.getCell(row, column + 1).value));
        const wanted = expected.rows.map(row => [row.id, row.name, row.department, row.title, row.eligibleForTraining ? "예" : "아니오"]);
        checks.headerAndShape = sheet.columnCount === 5 && headers.every((value, i) => sheet.getCell(1, i + 1).value === value);
        checks.visibleCells = !Array.from({ length: sheet.rowCount }, (_, i) => sheet.getRow(i + 1).hidden).some(Boolean)
          && !headers.some((_, i) => sheet.getColumn(i + 1).hidden);
        checks.literalValues = actual.every(row => row.every(value => typeof value === "string"));
        // Compare full row multisets, preserving duplicate counts and ignoring permitted row order.
        checks.sourceRowMultiset = JSON.stringify(actual.map(row => JSON.stringify(row)).sort()) === JSON.stringify(wanted.map(row => JSON.stringify(row)).sort());
        checks.nonemptySource = wanted.length > 0 && new Set(wanted.map(row => row[0])).size === wanted.length;
        observed = { rows: actual, sheetCount: workbook.worksheets.length, columns: sheet.columnCount };
      }
    } else {
      // Read OOXML directly, independently of production's mammoth extraction.
      const archive = await JSZip.loadAsync(bytes);
      const xml = await archive.file("word/document.xml")?.async("string");
      if (!xml) throw new Error("Missing document.xml");
      const decode = (text: string) => text.replace(/&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi, (_, numeric: string | undefined, named: string | undefined) => numeric
        ? String.fromCodePoint(numeric.startsWith("x") ? parseInt(numeric.slice(1), 16) : Number(numeric))
        : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[named!.toLowerCase()]!));
      const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map(match =>
        [...match[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(run => decode(run[1])).join(""));
      const wanted = [expected.title, `수신: ${expected.recipient}`, expected.body,
        `참석 예정 인원: ${expected.participantCount}명`, `예상 비용: ${expected.expenseKrw.toLocaleString("ko-KR")}원`, "본 문서는 ActFlow AI가 작성한 검토용 초안입니다."];
      checks.exactParagraphs = JSON.stringify(paragraphs) === JSON.stringify(wanted);
      observed = { paragraphs };
    }
  } catch {
    checks.readableFormat = false;
  }
  return { accepted: Object.keys(checks).length > 0 && Object.values(checks).every(Boolean), sha256: createHash("sha256").update(bytes).digest("hex"), checks, observed };
}
