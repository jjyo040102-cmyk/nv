import { extname } from "node:path";
import { parseDocx } from "./docx";
import { parseHwp } from "./hwp";
import { parseImage } from "./image";
import { parsePdf } from "./pdf";
import { parseText } from "./text";
import { DocumentParseError, type DocumentParser, type DetectedDocumentType, type ParseDocumentInput, type ParsedDocument, type ParserOptions } from "./types";

const formats: Record<string, { type: DetectedDocumentType; parser: DocumentParser; mimes: string[] }> = {
  ".txt": { type: "txt", parser: "txt", mimes: ["text/plain"] },
  ".pdf": { type: "pdf", parser: "pdf", mimes: ["application/pdf"] },
  ".docx": { type: "docx", parser: "docx", mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"] },
  ".png": { type: "image", parser: "image-ocr", mimes: ["image/png"] },
  ".jpg": { type: "image", parser: "image-ocr", mimes: ["image/jpeg"] },
  ".jpeg": { type: "image", parser: "image-ocr", mimes: ["image/jpeg"] },
  ".tif": { type: "image", parser: "image-ocr", mimes: ["image/tiff"] },
  ".tiff": { type: "image", parser: "image-ocr", mimes: ["image/tiff"] },
  ".hwp": { type: "hwp", parser: "hwp5", mimes: ["application/x-hwp", "application/haansofthwp"] }
};
function hasMagic(bytes: Uint8Array, type: DetectedDocumentType, extension: string): boolean {
  if (type === "txt") return true;
  const buffer = Buffer.from(bytes);
  if (type === "pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (type === "docx") return buffer.subarray(0, 2).toString("ascii") === "PK";
  if (type === "hwp") return buffer.subarray(0, 8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]));
  if (extension === ".png") return buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (extension === ".jpg" || extension === ".jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8;
  return (buffer.subarray(0, 4).toString("ascii") === "II*\0" || buffer.subarray(0, 4).toString("ascii") === "MM\0*");
}

export async function parseDocument(input: ParseDocumentInput, options: ParserOptions = {}): Promise<ParsedDocument> {
  const extension = extname(input.fileName).toLowerCase();
  const format = formats[extension];
  if (!format || !input.fileName || input.bytes.byteLength === 0) throw new DocumentParseError("router", input.fileName, false, "지원하지 않거나 비어 있는 문서입니다.");
  if (input.mimeType && input.mimeType !== "application/octet-stream" && !format.mimes.includes(input.mimeType.toLowerCase())) {
    throw new DocumentParseError("router", input.fileName, false, "파일 확장자와 MIME 형식이 일치하지 않습니다.");
  }
  if (!hasMagic(input.bytes, format.type, extension)) {
    throw new DocumentParseError(format.parser, input.fileName, false, "파일 형식이 확장자와 일치하지 않거나 손상되었습니다.");
  }
  const extracted = format.type === "txt" ? parseText(input)
    : format.type === "pdf" ? await parsePdf(input)
    : format.type === "docx" ? await parseDocx(input)
    : format.type === "image" ? await parseImage(input, options)
    : parseHwp(input);
  return { ...extracted, parser: format.parser, detectedType: format.type,
    source: { fileName: input.fileName, mimeType: input.mimeType, byteSize: input.bytes.byteLength } };
}
