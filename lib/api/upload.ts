import { createHash, randomUUID } from "node:crypto";
import { writeFile, mkdir, unlink } from "node:fs/promises";
import { dirname, extname } from "node:path";
import type { ApiRuntime } from "./runtime";
import { ApiError } from "./responses";
import { resolveWorkspacePath } from "../artifacts/workspace";
import { parseDocument } from "../documents/adapters";

export function safeDisplayName(name: string): string {
  if (!name || name.length > 180 || name !== name.normalize("NFKC") || name.includes("..") ||
      /[\\/\u2215\u2044\uff0f\uff3c:\x00-\x1f]/u.test(name) || /^(CON|PRN|AUX|NUL)(?:\.|$)/i.test(name) ||
      name.trim() !== name || name.endsWith(".")) throw new ApiError(400, "안전하지 않은 파일 이름입니다.");
  return name;
}
async function readBoundedMultipart(request: Request, byteLimit: number): Promise<FormData> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > byteLimit) {
    await request.body?.cancel().catch(() => undefined);
    throw new ApiError(413, "업로드 크기 제한을 초과했습니다.");
  }
  if (!request.body) throw new ApiError(400, "파일 업로드 형식이 올바르지 않습니다.");
  const reader = request.body.getReader(), chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > byteLimit) throw new ApiError(413, "업로드 크기 제한을 초과했습니다.");
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "파일 업로드 형식이 올바르지 않습니다.");
  } finally { reader.releaseLock(); }
  try {
    const body = new Uint8Array(Buffer.concat(chunks, total));
    return await new Response(body, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  } catch { throw new ApiError(400, "파일 업로드 형식이 올바르지 않습니다."); }
}
export async function createWorkflowFromUpload(request: Request, runtime: ApiRuntime, sessionId = "actflow-local-demo") {
  const limit = runtime.config.maxUploadMb * 1024 * 1024;
  // Bound the entire body, including fields and multipart overhead, before parsing.
  const form = await readBoundedMultipart(request, limit + 8192);
  const entries = form.getAll("file");
  if (entries.length !== 1 || !(entries[0] instanceof File)) throw new ApiError(400, "문서 파일 하나를 선택하세요.");
  const file = entries[0];
  const displayName = safeDisplayName(file.name);
  if (!file.size) throw new ApiError(400, "빈 파일은 업로드할 수 없습니다.");
  if (file.size > limit) throw new ApiError(413, "업로드 크기 제한을 초과했습니다.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const parsed = await parseDocument({ bytes, fileName: displayName, mimeType: file.type });
  const id = randomUUID();
  const storageName = `${randomUUID()}${extname(displayName).toLowerCase()}`;
  const path = resolveWorkspacePath(runtime.config.dataDir, id, "source", storageName);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, { flag: "wx" });
  const hash = createHash("sha256").update(bytes).digest("hex");
  const relativePath = `${id}/source/${storageName}`;
  try {
    runtime.db.transaction(() => {
      runtime.repo.createWorkflow({ id, sourceName: displayName, sourceMime: file.type, sourceSha256: hash,
        sourcePath: relativePath, sourceText: parsed.text });
      runtime.db.prepare("UPDATE workflows SET owner_session_id=? WHERE id=?").run(sessionId, id);
      runtime.db.prepare("INSERT INTO source_documents(id,workflow_id,display_name,mime_type,byte_size,sha256,relative_path,parse_status,created_at) VALUES (?,?,?,?,?,?,?,'PARSED',?)")
        .run(randomUUID(), id, displayName, file.type, bytes.byteLength, hash, relativePath, new Date().toISOString());
    })();
  } catch (error) { await unlink(path); throw error; }
  return { workflow: runtime.repo.getWorkflow(id)!, source: { displayName, parser: parsed.parser, detectedType: parsed.detectedType,
    warnings: parsed.warnings, byteSize: bytes.byteLength, sha256: hash } };
}
