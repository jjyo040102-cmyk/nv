import { PDFParse } from "pdf-parse";
import { DocumentParseError, type ParseDocumentInput } from "./types";

export async function parsePdf(input: ParseDocumentInput): Promise<{ text: string; warnings: string[] }> {
  let parser: PDFParse | undefined;
  try {
    parser = new PDFParse({ data: new Uint8Array(input.bytes) });
    const result = await parser.getText();
    const text = result.text.replace(/-- \d+ of \d+ --/g, "").trim();
    return { text, warnings: text ? [] : ["PDF에서 추출 가능한 텍스트가 없습니다. 스캔 문서일 수 있습니다. OCR은 자동으로 실행하지 않았습니다."] };
  } catch {
    throw new DocumentParseError("pdf", input.fileName, false, "PDF를 읽을 수 없습니다. 파일이 손상되었거나 보호되어 있을 수 있습니다.");
  } finally {
    await parser?.destroy().catch(() => undefined);
  }
}
