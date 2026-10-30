import { DocumentParseError, type ParseDocumentInput } from "./types";

export function parseText(input: ParseDocumentInput): { text: string; warnings: string[] } {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
    return { text: text.replace(/^\uFEFF/, ""), warnings: text.trim() ? [] : ["텍스트 파일이 비어 있습니다."] };
  } catch {
    throw new DocumentParseError("txt", input.fileName, false, "UTF-8 텍스트로 읽을 수 없습니다.");
  }
}
