import mammoth from "mammoth";
import { DocumentParseError, type ParseDocumentInput } from "./types";

export async function parseDocx(input: ParseDocumentInput): Promise<{ text: string; warnings: string[] }> {
  try {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(input.bytes) });
    const text = result.value.trim();
    return { text, warnings: text ? [] : ["DOCX에 추출 가능한 텍스트가 없습니다."] };
  } catch {
    throw new DocumentParseError("docx", input.fileName, false, "DOCX를 읽을 수 없습니다. 파일이 손상되었거나 지원되지 않는 형식입니다.");
  }
}
