import { writeFile } from "node:fs/promises";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type { GeneratedArtifact } from "./xlsxGenerator";

export type ResponseDocumentInput = { title: string; recipient: string; body: string; participantCount: number; expenseKrw: number };

export async function buildResponseDocxBytes(input: ResponseDocumentInput): Promise<Buffer> {
  const document = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({ text: input.title, heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ children: [new TextRun({ text: "수신: ", bold: true }), new TextRun(input.recipient)] }),
        new Paragraph({ text: input.body }),
        new Paragraph({ text: `참석 예정 인원: ${input.participantCount}명` }),
        new Paragraph({ text: `예상 비용: ${input.expenseKrw.toLocaleString("ko-KR")}원` }),
        new Paragraph({ text: "본 문서는 ActFlow AI가 작성한 검토용 초안입니다." })
      ]
    }]
  });
  return Packer.toBuffer(document);
}

export async function generateResponseDocx(input: ResponseDocumentInput, destination: string): Promise<GeneratedArtifact> {
  const buffer = await buildResponseDocxBytes(input);
  await writeFile(destination, buffer, { flag: "wx" });
  return { path: destination, format: "docx", byteSize: buffer.byteLength };
}
