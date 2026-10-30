import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { deflateRawSync } from "node:zlib";
import * as CFB from "cfb";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { PNG } from "pngjs";
import { generateResponseDocx } from "../../lib/artifacts/docxGenerator";
import { DocumentParseError } from "../../lib/documents/types";
import { parseDocument } from "../../lib/documents/adapters";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) { if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected cleanup target"); rmSync(root, { recursive: true, force: true }); } });
function makeHwp(text: string, flags = 0) {
  const cfb = CFB.utils.cfb_new();
  const header = Buffer.alloc(256);
  header.write("HWP Document File", 0, "ascii");
  header[35] = 5;
  header.writeUInt32LE(flags, 36);
  CFB.utils.cfb_add(cfb, "FileHeader", header);
  const content = Buffer.from(text, "utf16le");
  const record = Buffer.alloc(4 + content.length);
  record.writeUInt32LE(67 | (1 << 10) | (content.length << 20), 0);
  content.copy(record, 4);
  CFB.utils.cfb_add(cfb, "BodyText/Section0", flags & 1 ? deflateRawSync(record) : record);
  return CFB.write(cfb, { type: "buffer" }) as Buffer;
}
async function makePdf(text?: string) {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 300]);
  if (text) { const font = await document.embedFont(StandardFonts.Helvetica); page.drawText(text, { x: 40, y: 250, size: 18, font }); }
  return document.save();
}
function makeTestImage() {
  const glyphs: Record<string, string[]> = {
    T: ["11111","00100","00100","00100","00100","00100","00100"],
    E: ["11111","10000","10000","11110","10000","10000","11111"],
    S: ["01111","10000","10000","01110","00001","00001","11110"]
  };
  const image = new PNG({ width: 520, height: 160, colorType: 2 });
  image.data.fill(255);
  const word = "TEST";
  const scale = 16;
  for (let index = 0; index < word.length; index++) {
    const glyph = glyphs[word[index]];
    for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) if (glyph[y][x] === "1") {
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        const pixel = ((25 + y * scale + sy) * image.width + (35 + index * 7 * scale + x * scale + sx)) * 4;
        image.data[pixel] = 0; image.data[pixel + 1] = 0; image.data[pixel + 2] = 0; image.data[pixel + 3] = 255;
      }
    }
  }
  return PNG.sync.write(image);
}

describe("document parser routing", () => {
  it("reads UTF-8 TXT without invented content", async () => {
    const bytes = readFileSync(resolve("tests/fixtures/documents/training-notice.txt"));
    const parsed = await parseDocument({ bytes, fileName: "training-notice.txt", mimeType: "text/plain" });
    expect(parsed.parser).toBe("txt");
    expect(parsed.text).toContain("2026-11-20");
    expect(parsed.text).toContain("180,000원");
  });
  it("extracts actual PDF text and warns on textless scanned-like PDF", async () => {
    const parsed = await parseDocument({ bytes: await makePdf("Training notice"), fileName: "notice.pdf", mimeType: "application/pdf" });
    expect(parsed.text).toContain("Training notice");
    const blank = await parseDocument({ bytes: await makePdf(), fileName: "blank.pdf", mimeType: "application/pdf" });
    expect(blank.text).toBe("");
    expect(blank.warnings.join(" ")).toMatch(/스캔|텍스트/);
  });
  it("extracts DOCX raw text", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "actflow-parser-")); roots.push(root);
    const path = resolve(root, "response.docx");
    await generateResponseDocx({ title: "교육 회신", recipient: "교육팀", body: "참석합니다.", participantCount: 1, expenseKrw: 180_000 }, path);
    const parsed = await parseDocument({ bytes: readFileSync(path), fileName: "response.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    expect(parsed.text).toContain("참석합니다.");
  });
  it("recognizes clear English text in a real PNG", async () => {
    const parsed = await parseDocument({ bytes: makeTestImage(), fileName: "test.png", mimeType: "image/png" }, { ocrLanguages: ["eng"] });
    expect(parsed.parser).toBe("image-ocr");
    expect(parsed.text.toUpperCase()).toContain("TEST");
  }, 120_000);
  it("extracts paragraph records from unencrypted HWP 5.x OLE", async () => {
    const parsed = await parseDocument({ bytes: makeHwp("교육 참석 안내"), fileName: "notice.hwp", mimeType: "application/x-hwp" });
    expect(parsed.parser).toBe("hwp5");
    expect(parsed.text).toContain("교육 참석 안내");
  });
  it("inflates only HWP files marked compressed", async () => {
    const parsed = await parseDocument({ bytes: makeHwp("압축된 교육 안내", 1), fileName: "compressed.hwp", mimeType: "application/x-hwp" });
    expect(parsed.text).toContain("압축된 교육 안내");
  });
  it.each([[2, "암호"], [4, "배포"]])("rejects protected HWP flag %i", async (flag, message) => {
    await expect(parseDocument({ bytes: makeHwp("비밀", flag), fileName: "protected.hwp", mimeType: "application/x-hwp" }))
      .rejects.toMatchObject({ parser: "hwp5", fileName: "protected.hwp", retryable: false, safeMessage: expect.stringContaining(message) });
  });
  it.each([
    ["corrupt.pdf", "application/pdf", new Uint8Array([1,2,3]), "pdf"],
    ["corrupt.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", new Uint8Array([1,2,3]), "docx"],
    ["corrupt.hwp", "application/x-hwp", new Uint8Array([1,2,3]), "hwp5"],
    ["corrupt.png", "image/png", new Uint8Array([1,2,3]), "image-ocr"]
  ])("returns a typed safe error for %s", async (fileName, mimeType, bytes, parser) => {
    try { await parseDocument({ bytes, fileName, mimeType }); throw new Error("Expected parser failure"); }
    catch (error) {
      expect(error).toBeInstanceOf(DocumentParseError);
      expect(error).toMatchObject({ fileName, parser, safeMessage: expect.any(String), retryable: expect.any(Boolean) });
      expect(JSON.stringify(error)).not.toContain("stack");
    }
  });
  it("rejects unknown extension and mismatched MIME", async () => {
    await expect(parseDocument({ bytes: new Uint8Array([1]), fileName: "attack.exe", mimeType: "application/octet-stream" })).rejects.toMatchObject({ parser: "router", retryable: false });
    await expect(parseDocument({ bytes: Buffer.from("hello"), fileName: "notice.pdf", mimeType: "text/plain" })).rejects.toMatchObject({ parser: "router", retryable: false });
  });
});
