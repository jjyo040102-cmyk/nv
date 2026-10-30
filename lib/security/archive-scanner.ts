import JSZip from 'jszip';
import { scanSecrets, type SecretFinding } from './secret-scanner';

export type ArchiveLimits = { maxDepth: number; maxFiles: number; maxUncompressedBytes: number };
export type ArchiveScanResult = {
  safe: boolean; fileCount: number; uncompressedBytes: number;
  secretFindings: Array<SecretFinding & { path: string }>; blockedReason: string | null; entries: string[];
};
const defaults: ArchiveLimits = { maxDepth: 3, maxFiles: 200, maxUncompressedBytes: 25 * 1024 * 1024 };
class UnsafeArchive extends Error { constructor(readonly reason: string) { super(reason); } }
const block = (reason: string): never => { throw new UnsafeArchive(reason); };
export function isZipContent(buffer: Buffer): boolean {
  return buffer.length >= 4 && [0x04034b50, 0x06054b50, 0x08074b50].includes(buffer.readUInt32LE(0));
}
function unsafePath(name: string): boolean {
  return !name || /[\x00-\x1f\x7f]/.test(name) || /^[\\/]/.test(name) || /^[A-Za-z]:/.test(name) ||
    name.split(/[\\/]+/).some(part => part === '..') || name.includes(':');
}
type EntryHeader = { name: string; crc: number; expanded: number; directory: boolean };
/** Validate the original ZIP metadata BEFORE JSZip can normalize names or inflate bytes. */
function preflight(buffer: Buffer, limits: ArchiveLimits, used: ArchiveScanResult): EntryHeader[] {
  if (buffer.length > limits.maxUncompressedBytes) block('ARCHIVE_COMPRESSED_SIZE_LIMIT');
  if (!isZipContent(buffer)) block('ARCHIVE_UNREADABLE_OR_ENCRYPTED');
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break; }
  }
  if (end < 0 || buffer.readUInt16LE(end + 4) !== 0 || buffer.readUInt16LE(end + 6) !== 0) block('ARCHIVE_UNREADABLE_OR_ENCRYPTED');
  const count = buffer.readUInt16LE(end + 10), diskCount = buffer.readUInt16LE(end + 8);
  const centralSize = buffer.readUInt32LE(end + 12), centralStart = buffer.readUInt32LE(end + 16);
  if (count === 0xffff || centralSize === 0xffffffff || centralStart === 0xffffffff || count !== diskCount || centralStart + centralSize !== end) block('ARCHIVE_UNSUPPORTED_FORMAT');
  if (count > limits.maxFiles * 4) block('ARCHIVE_FILE_LIMIT');
  const headers: EntryHeader[] = [], names = new Set<string>(), ranges: Array<[number, number]> = [];
  let offset = centralStart, expanded = 0, files = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) block('ARCHIVE_UNREADABLE_OR_ENCRYPTED');
    const flags = buffer.readUInt16LE(offset + 8), method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20), size = buffer.readUInt32LE(offset + 24);
    const n = buffer.readUInt16LE(offset + 28), extra = buffer.readUInt16LE(offset + 30), comment = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42), next = offset + 46 + n + extra + comment;
    if (next > end || [compressed, size, local].includes(0xffffffff) || buffer.readUInt16LE(offset + 34) !== 0 || (flags & 0x41) || ![0, 8].includes(method)) block('ARCHIVE_UNREADABLE_OR_ENCRYPTED');
    // CP437 and Unicode path overrides are deliberately not guessed at this egress boundary.
    const nameBytes = buffer.subarray(offset + 46, offset + 46 + n);
    const name = nameBytes.toString('utf8');
    if (name.includes('\ufffd') || (!(flags & 0x800) && [...nameBytes].some(b => b > 127))) block('ARCHIVE_UNSUPPORTED_FILENAME');
    if (unsafePath(name)) block('ARCHIVE_PATH_TRAVERSAL');
    if (names.has(name)) block('ARCHIVE_DUPLICATE_ENTRY');
    names.add(name);
    for (let p = offset + 46 + n; p < offset + 46 + n + extra;) {
      if (p + 4 > offset + 46 + n + extra) block('ARCHIVE_UNREADABLE_OR_ENCRYPTED');
      const kind = buffer.readUInt16LE(p), length = buffer.readUInt16LE(p + 2); p += 4;
      if (p + length > offset + 46 + n + extra || kind === 0x0001) block('ARCHIVE_UNSUPPORTED_FORMAT');
      if (kind === 0x7075) {
        if (length < 5 || buffer.subarray(p + 5, p + length).toString('utf8') !== name) block('ARCHIVE_UNSUPPORTED_FILENAME');
      }
      p += length;
    }
    const unixMode = buffer.readUInt32LE(offset + 38) >>> 16;
    if ((unixMode & 0xf000) === 0xa000) block('ARCHIVE_SYMLINK');
    if (local + 30 > centralStart || buffer.readUInt32LE(local) !== 0x04034b50) block('ARCHIVE_UNREADABLE_OR_ENCRYPTED');
    const localNameLength = buffer.readUInt16LE(local + 26), localExtraLength = buffer.readUInt16LE(local + 28);
    const dataStart = local + 30 + localNameLength + localExtraLength, dataEnd = dataStart + compressed;
    if (dataEnd > centralStart || buffer.readUInt16LE(local + 6) !== flags || buffer.readUInt16LE(local + 8) !== method ||
        !buffer.subarray(local + 30, local + 30 + localNameLength).equals(nameBytes)) block('ARCHIVE_HEADER_MISMATCH');
    ranges.push([local, dataEnd]);
    const directory = name.endsWith('/');
    if (directory && (size !== 0 || compressed !== 0)) block('ARCHIVE_HEADER_MISMATCH');
    if (!directory) { files++; expanded += size; }
    if (files + used.fileCount > limits.maxFiles) block('ARCHIVE_FILE_LIMIT');
    if (expanded + used.uncompressedBytes > limits.maxUncompressedBytes) block('ARCHIVE_EXPANDED_SIZE_LIMIT');
    headers.push({ name, crc: buffer.readUInt32LE(offset + 16), expanded: size, directory });
    offset = next;
  }
  if (offset !== end) block('ARCHIVE_UNREADABLE_OR_ENCRYPTED');
  ranges.sort((a, b) => a[0] - b[0]);
  if (ranges.some((range, i) => i > 0 && ranges[i - 1][1] > range[0])) block('ARCHIVE_OVERLAPPING_ENTRIES');
  return headers;
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function readBounded(entry: JSZip.JSZipObject, expected: EntryHeader, limits: ArchiveLimits, state: ArchiveScanResult): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let bytes = 0, crc = 0xffffffff;
    const stream = entry.nodeStream('nodebuffer');
    const destroy = "destroy" in stream ? stream.destroy : undefined;
    if (typeof destroy !== "function") { reject(new UnsafeArchive('ARCHIVE_UNREADABLE_OR_ENCRYPTED')); return; }
    stream.on('data', (chunk: Buffer) => {
      bytes += chunk.length; state.uncompressedBytes += chunk.length;
      if (bytes > expected.expanded || state.uncompressedBytes > limits.maxUncompressedBytes) {
        destroy.call(stream, new UnsafeArchive('ARCHIVE_EXPANDED_SIZE_LIMIT')); return;
      }
      for (const byte of chunk) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
      chunks.push(chunk);
    });
    stream.once('error', reject);
    stream.once('end', () => {
      if (bytes !== expected.expanded || ((crc ^ 0xffffffff) >>> 0) !== expected.crc) reject(new UnsafeArchive('ARCHIVE_INTEGRITY_FAILURE'));
      else resolve(Buffer.concat(chunks, bytes));
    });
  });
}
export async function scanArchive(buffer: Buffer, limits: Partial<ArchiveLimits> = {}, depth = 0, prefix = ''): Promise<ArchiveScanResult> {
  const configured = { ...defaults, ...limits };
  const state: ArchiveScanResult = { safe: false, fileCount: 0, uncompressedBytes: 0, secretFindings: [], blockedReason: null, entries: [] };
  async function visit(data: Buffer, level: number, pathPrefix: string): Promise<void> {
    if (level > configured.maxDepth) block('ARCHIVE_MAX_DEPTH');
    const headers = preflight(data, configured, state);
    const zip = await JSZip.loadAsync(data, { checkCRC32: false, createFolders: false });
    for (const header of headers) {
      if (header.directory) continue;
      const path = pathPrefix ? `${pathPrefix}/${header.name}` : header.name;
      if (++state.fileCount > configured.maxFiles) block('ARCHIVE_FILE_LIMIT');
      state.entries.push(path);
      const entry = zip.files[header.name];
      if (!entry || entry.dir) block('ARCHIVE_HEADER_MISMATCH');
      const expanded = await readBounded(entry, header, configured, state);
      if (isZipContent(expanded) || /\.(?:zip|docx|xlsx|pptx|jar|odt|ods)$/i.test(header.name)) await visit(expanded, level + 1, path);
      else {
        if (/\.(?:7z|rar|tar|gz|bz2|xz)$/i.test(header.name)) block('ARCHIVE_UNSUPPORTED_FORMAT');
        for (const finding of scanSecrets(expanded)) state.secretFindings.push({ ...finding, path });
      }
    }
  }
  try {
    if (!Number.isInteger(depth) || depth < 0 || !Object.values(configured).every(n => Number.isSafeInteger(n) && n >= 0) || configured.maxFiles < 1 || configured.maxUncompressedBytes < 1) block('ARCHIVE_INVALID_LIMITS');
    await visit(buffer, depth, prefix);
    state.safe = state.secretFindings.length === 0;
    state.blockedReason = state.safe ? null : 'SECRET_IN_ARCHIVE';
  } catch (error) { state.blockedReason = error instanceof UnsafeArchive ? error.reason : 'ARCHIVE_UNREADABLE_OR_ENCRYPTED'; }
  return state;
}
