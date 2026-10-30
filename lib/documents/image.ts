import { createWorker } from "tesseract.js";
import { DocumentParseError, type ParseDocumentInput, type ParserOptions } from "./types";

export async function parseImage(input: ParseDocumentInput, options: ParserOptions = {}): Promise<{ text: string; warnings: string[] }> {
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  try {
    worker = await createWorker(options.ocrLanguages ?? ["kor", "eng"]);
    const result = await worker.recognize(Buffer.from(input.bytes));
    const text = result.data.text.trim();
    return { text, warnings: text ? [] : ["이미지에서 문자를 인식하지 못했습니다."] };
  } catch {
    throw new DocumentParseError("image-ocr", input.fileName, true, "이미지 OCR에 실패했습니다. 선명한 이미지로 다시 시도해 주세요.");
  } finally {
    await worker?.terminate().catch(() => undefined);
  }
}
