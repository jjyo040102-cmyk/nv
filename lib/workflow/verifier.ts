import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import type { ParticipantRow } from "../artifacts/xlsxGenerator";
import type { ResponseDocumentInput } from "../artifacts/docxGenerator";

export type ArtifactGoal = { type: "participants"; version: 1; rows: ParticipantRow[] } | ({ type: "response"; version: 1 } & ResponseDocumentInput);
export type VerifyArtifactInput = { path: string; kind: "xlsx" | "docx"; requiredTexts: string[]; goal?: ArtifactGoal; expectedSha256?: string | null };
export type VerificationResult = {
  passed: boolean;
  format: "xlsx" | "docx";
  size: number;
  sha256: string | null;
  requiredFieldsPassed: boolean;
  goalSatisfied: boolean | null;
  verifierVersion: string;
  checkedAt: string;
  parsedStructure: Record<string, number | string>;
  evidence: { requiredTexts: string[]; foundTexts: string[]; errorCode?: string; goalHash?: string; predicates?: Array<{ id: string; passed: boolean }> };
};

export async function verifyArtifact(input: VerifyArtifactInput): Promise<VerificationResult> {
  const result: VerificationResult = {
    passed: false, format: input.kind, size: 0, sha256: null, requiredFieldsPassed: false,
    goalSatisfied: input.goal ? false : null,
    verifierVersion: "actflow-verifier-v2", checkedAt: new Date().toISOString(),
    parsedStructure: {}, evidence: { requiredTexts: input.requiredTexts, foundTexts: [] }
  };
  if (input.goal) {
    result.evidence.goalHash = createHash("sha256").update(JSON.stringify(input.goal)).digest("hex");
    result.evidence.predicates = [];
  }
  const predicate = (id: string, passed: boolean) => result.evidence.predicates!.push({ id, passed });
  try {
    if (extname(input.path).toLowerCase() !== `.${input.kind}`) throw new Error("WRONG_EXTENSION");
    const fileStat = await stat(input.path);
    if (!fileStat.isFile() || fileStat.size === 0) throw new Error("EMPTY_OR_NOT_FILE");
    if (fileStat.size > 25 * 1024 * 1024) throw new Error("ARTIFACT_TOO_LARGE");
    const bytes = await readFile(input.path);
    result.size = bytes.byteLength;
    result.sha256 = createHash("sha256").update(bytes).digest("hex");
    if (input.expectedSha256 && result.sha256 !== input.expectedSha256) throw new Error("ARTIFACT_CHANGED");
    let text = "";
    if (input.kind === "xlsx") {
      const { default: ExcelJS } = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      if (workbook.worksheets.length === 0) throw new Error("NO_WORKSHEET");
      const fragments: string[] = [];
      for (const sheet of workbook.worksheets) sheet.eachRow(row => row.eachCell(cell => fragments.push(String(cell.text ?? ""))));
      text = fragments.join("\n");
      result.parsedStructure = { worksheetCount: workbook.worksheets.length, rowCount: workbook.worksheets.reduce((sum, sheet) => sum + sheet.rowCount, 0) };
      if (input.goal) {
        if (input.goal.type !== "participants" || input.goal.version !== 1) throw new Error("WRONG_GOAL_TYPE");
        const expected = input.goal.rows;
        const sheet = workbook.worksheets[0];
        const headers = ["사번", "이름", "부서", "직책", "교육 대상"];
        const layout = workbook.worksheets.length === 1 && sheet.state === "visible" && sheet.name === "참석자 명단" &&
          sheet.columnCount === headers.length && headers.every((header, i) => sheet.getCell(1, i + 1).value === header && !sheet.getColumn(i + 1).hidden) && !sheet.getRow(1).hidden;
        predicate("roster.layout", layout);
        const expectedById = new Map(expected.map(row => [row.id, row]));
        const ids = new Set<string>();
        let valuesMatch = expected.length > 0 && expectedById.size === expected.length;
        for (let index = 2; index <= sheet.rowCount; index++) {
          const row = sheet.getRow(index);
          const values = headers.map((_, i) => row.getCell(i + 1).value);
          const id = values[0];
          const source = typeof id === "string" ? expectedById.get(id) : undefined;
          if (!source || typeof id !== "string" || ids.has(id) || row.hidden || values.some(value => typeof value !== "string")) valuesMatch = false;
          else {
            ids.add(id);
            const required = [source.id, source.name, source.department, source.title, source.eligibleForTraining ? "예" : "아니오"];
            if (required.some((value, i) => values[i] !== value)) valuesMatch = false;
          }
        }
        predicate("roster.exact_rows", sheet.rowCount === expected.length + 1 && ids.size === expected.length);
        predicate("roster.source_values_and_literal_cells", valuesMatch);
        result.parsedStructure.expectedParticipantCount = expected.length;
      }
    } else {
      const { default: mammoth } = await import("mammoth");
      const extracted = await mammoth.extractRawText({ buffer: bytes });
      text = extracted.value;
      if (!text.trim()) throw new Error("EMPTY_DOCUMENT_TEXT");
      result.parsedStructure = { characterCount: text.length };
      if (input.goal) {
        if (input.goal.type !== "response" || input.goal.version !== 1) throw new Error("WRONG_GOAL_TYPE");
        const goal = input.goal;
        const paragraphs = text.trim().split(/\r?\n\s*\r?\n/).map(value => value.trim());
        predicate("response.structure", paragraphs.length === 6);
        predicate("response.title_recipient_body", paragraphs[0] === goal.title && paragraphs[1] === `수신: ${goal.recipient}` && paragraphs[2] === goal.body);
        predicate("response.participant_count", paragraphs[3] === `참석 예정 인원: ${goal.participantCount}명`);
        predicate("response.expense", paragraphs[4] === `예상 비용: ${goal.expenseKrw.toLocaleString("ko-KR")}원`);
        predicate("response.draft_label", paragraphs[5] === "본 문서는 ActFlow AI가 작성한 검토용 초안입니다.");
      }
    }
    result.evidence.foundTexts = input.requiredTexts.filter(phrase => text.includes(phrase));
    result.requiredFieldsPassed = result.evidence.foundTexts.length === input.requiredTexts.length;
    if (input.goal) result.goalSatisfied = Boolean(result.evidence.predicates?.length) && result.evidence.predicates!.every(item => item.passed);
    result.passed = result.requiredFieldsPassed && result.goalSatisfied !== false;
    if (!result.passed) result.evidence.errorCode = result.goalSatisfied === false ? "GOAL_MISMATCH" : "REQUIRED_TEXT_MISSING";
  } catch (error) {
    result.evidence.errorCode = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "FORMAT_OR_READ_ERROR";
  }
  return result;
}
