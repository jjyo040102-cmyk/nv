import { inflateRawSync } from "node:zlib";
import * as CFB from "cfb";
import { DocumentParseError, type ParseDocumentInput } from "./types";

function fail(fileName: string, message: string): never {
  throw new DocumentParseError("hwp5", fileName, false, message);
}
function paragraphText(bytes: Buffer, fileName: string): string {
  if (bytes.length % 2 !== 0) fail(fileName, "HWP 문단 텍스트가 손상되었습니다.");
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 2) {
    const code = bytes.readUInt16LE(offset);
    if (code === 0 || code === 13) continue;
    if (code === 9) { text += "\t"; continue; }
    if (code < 32) fail(fileName, "HWP의 복잡한 문단 제어 문자는 현재 지원하지 않습니다.");
    text += String.fromCharCode(code);
  }
  return text;
}

export function parseHwp(input: ParseDocumentInput): { text: string; warnings: string[] } {
  try {
    const container = CFB.read(Buffer.from(input.bytes), { type: "buffer" });
    const headerEntry = CFB.find(container, "FileHeader");
    if (!headerEntry?.content) fail(input.fileName, "HWP FileHeader가 없습니다.");
    const header = Buffer.from(headerEntry.content);
    if (header.length < 40 || header.subarray(0, 17).toString("ascii") !== "HWP Document File" || header[35] !== 5) {
      fail(input.fileName, "지원되는 HWP 5.x 문서가 아닙니다.");
    }
    const flags = header.readUInt32LE(36);
    if (flags & 2) fail(input.fileName, "암호로 보호된 HWP 문서는 지원하지 않습니다.");
    if (flags & 4) fail(input.fileName, "배포용 HWP 문서는 지원하지 않습니다.");
    if (flags & 16) fail(input.fileName, "DRM 보호 HWP 문서는 지원하지 않습니다.");
    const sectionPaths = container.FullPaths.filter(path => /\/BodyText\/Section\d+$/i.test(path))
      .sort((a, b) => Number(a.match(/Section(\d+)/i)?.[1] ?? 0) - Number(b.match(/Section(\d+)/i)?.[1] ?? 0));
    if (!sectionPaths.length) fail(input.fileName, "HWP BodyText 섹션이 없습니다.");
    const paragraphs: string[] = [];
    for (const path of sectionPaths) {
      const entry = CFB.find(container, path);
      if (!entry?.content) fail(input.fileName, "HWP 섹션을 읽을 수 없습니다.");
      const stored = Buffer.from(entry.content);
      const section = flags & 1 ? inflateRawSync(stored, { maxOutputLength: 25 * 1024 * 1024 }) : stored;
      let offset = 0;
      while (offset < section.length) {
        if (offset + 4 > section.length) fail(input.fileName, "HWP 레코드 헤더가 손상되었습니다.");
        const record = section.readUInt32LE(offset); offset += 4;
        const tag = record & 0x3ff;
        let size = record >>> 20;
        if (size === 0xfff) {
          if (offset + 4 > section.length) fail(input.fileName, "HWP 확장 레코드가 손상되었습니다.");
          size = section.readUInt32LE(offset); offset += 4;
        }
        if (size > 25 * 1024 * 1024 || offset + size > section.length) fail(input.fileName, "HWP 레코드 길이가 올바르지 않습니다.");
        if (tag === 67) {
          const text = paragraphText(section.subarray(offset, offset + size), input.fileName);
          if (text.trim()) paragraphs.push(text);
        }
        offset += size;
      }
    }
    const text = paragraphs.join("\n");
    return { text, warnings: text ? [] : ["HWP에 추출 가능한 문단 텍스트가 없습니다."] };
  } catch (error) {
    if (error instanceof DocumentParseError) throw error;
    throw new DocumentParseError("hwp5", input.fileName, false, "HWP 5.x OLE 문서를 읽을 수 없습니다.");
  }
}
