import ExcelJS from "exceljs";

export type ParticipantRow = { id: string; name: string; department: string; title: string; eligibleForTraining: boolean };
export type GeneratedArtifact = { path: string; format: "xlsx" | "docx"; byteSize: number };

export async function buildParticipantsXlsxBytes(input: ParticipantRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ActFlow AI";
  const sheet = workbook.addWorksheet("참석자 명단");
  sheet.columns = [
    { header: "사번", key: "id", width: 14 },
    { header: "이름", key: "name", width: 18 },
    { header: "부서", key: "department", width: 22 },
    { header: "직책", key: "title", width: 18 },
    { header: "교육 대상", key: "eligible", width: 16 }
  ];
  for (const row of input) sheet.addRow({ id: row.id, name: row.name, department: row.department, title: row.title, eligible: row.eligibleForTraining ? "예" : "아니오" });
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B3B66" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  const bytes = await workbook.xlsx.writeBuffer();
  return Buffer.from(bytes);
}

export async function generateParticipantsXlsx(input: ParticipantRow[], destination: string): Promise<GeneratedArtifact> {
  const buffer = await buildParticipantsXlsxBytes(input);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(destination, buffer, { flag: "wx" });
  return { path: destination, format: "xlsx", byteSize: buffer.byteLength };
}
