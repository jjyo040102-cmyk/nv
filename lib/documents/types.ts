import { DomainError } from "../domain/errors";
export type DocumentParser = "router" | "txt" | "pdf" | "docx" | "image-ocr" | "hwp5";
export type DetectedDocumentType = "txt" | "pdf" | "docx" | "image" | "hwp";
export type ParseDocumentInput = { bytes: Uint8Array; fileName: string; mimeType: string };
export type ParsedDocument = {
  text: string;
  parser: DocumentParser;
  detectedType: DetectedDocumentType;
  warnings: string[];
  source: { fileName: string; mimeType: string; byteSize: number };
};
export type ParserOptions = { ocrLanguages?: string[] };

export class DocumentParseError extends DomainError {
  constructor(
    readonly parser: DocumentParser,
    readonly fileName: string,
    readonly retryable: boolean,
    readonly safeMessage: string
  ) {
    super("DOCUMENT_PARSE", safeMessage);
    this.name = "DocumentParseError";
  }
  toJSON() { return { name: this.name, parser: this.parser, fileName: this.fileName, retryable: this.retryable, safeMessage: this.safeMessage }; }
}
