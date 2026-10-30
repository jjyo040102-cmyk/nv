import type { Participant } from './task-types';

const encoder = new TextEncoder();
function xml(value: string | number): string {
  return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files: Record<string, string>): Uint8Array {
  const chunks: Uint8Array[] = [], directory: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const filename = encoder.encode(name), data = encoder.encode(text), crc = crc32(data);
    const local = new Uint8Array(30 + filename.length), view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
    view.setUint32(14, crc, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true); view.setUint16(26, filename.length, true);
    local.set(filename, 30); chunks.push(local, data);
    const central = new Uint8Array(46 + filename.length), cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, filename.length, true); cv.setUint32(42, offset, true);
    central.set(filename, 46); directory.push(central); offset += local.length + data.length;
  }
  const directoryLength = directory.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, directory.length, true); ev.setUint16(10, directory.length, true);
  ev.setUint32(12, directoryLength, true); ev.setUint32(16, offset, true);
  const output = new Uint8Array(offset + directoryLength + end.length); let position = 0;
  for (const chunk of [...chunks, ...directory, end]) { output.set(chunk, position); position += chunk.length; }
  return output;
}

const rootRels = (type: string, target: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/></Relationships>`;

export function participantsXlsx(participants: Participant[]): Uint8Array {
  const rows = [['Employee ID', 'Name', 'Department', 'Role'], ...participants.map(p => [p.id, p.name, p.department, p.role])];
  const sheetRows = rows.map((row, index) => `<row r="${index + 1}">${row.map((value, col) => `<c r="${String.fromCharCode(65 + col)}${index + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join('')}</row>`).join('');
  return zip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': rootRels('officeDocument', 'xl/workbook.xml'),
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Participants" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': rootRels('worksheet', 'worksheets/sheet1.xml'),
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="4" width="25" customWidth="1"/></cols><sheetData>${sheetRows}</sheetData></worksheet>`,
  });
}

export function responseDocx(input: { recipient: string; body: string; participants: number; expenseKrw: number }): Uint8Array {
  const lines = ['Response draft', `To: ${input.recipient}`, ...input.body.split(/\r?\n/), `Participants: ${input.participants}`, `Estimated travel expense: KRW ${input.expenseKrw.toLocaleString('en-US')}`, 'Prepared for review in ActFlow.'];
  const paragraphs = lines.map(line => `<w:p><w:r><w:t xml:space="preserve">${xml(line)}</w:t></w:r></w:p>`).join('');
  return zip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': rootRels('officeDocument', 'word/document.xml'),
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr/></w:body></w:document>`,
  });
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
