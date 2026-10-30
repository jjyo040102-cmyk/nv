import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getRuntime } from "@/lib/api/runtime";
import { ApiError, apiFailure } from "@/lib/api/responses";
import { WorkflowIdSchema } from "@/lib/api/schemas";
import { ArtifactWorkspace, resolveWorkspacePath } from "@/lib/artifacts/workspace";
import { resolveSessionActor } from "@/lib/security/session";
import { assertWorkflowAccess } from "@/lib/api/access";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveSessionActor(request);
    const { id } = await context.params; WorkflowIdSchema.parse(id);
    const app = getRuntime();
    const artifact = new ArtifactWorkspace(app.db, app.config.dataDir).getArtifact(id);
    if (!artifact) throw new ApiError(404, "파일을 찾을 수 없습니다.");
    assertWorkflowAccess(app, artifact.workflowId, actor);
    if (artifact.state !== "COMMITTED" || artifact.verificationStatus !== "VERIFIED") throw new ApiError(409, "확정되고 검증된 파일만 다운로드할 수 있습니다.");
    const parts = artifact.relativePath.split("/");
    if (parts.length !== 3 || parts[0] !== artifact.workflowId || parts[1] !== "committed") throw new ApiError(409, "파일 경로 검증에 실패했습니다.");
    const bytes = await readFile(resolveWorkspacePath(app.config.dataDir, artifact.workflowId, "committed", parts[2]));
    if (bytes.byteLength !== artifact.byteSize || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) {
      app.db.prepare("UPDATE artifacts SET verification_status='FAILED' WHERE id=?").run(id);
      throw new ApiError(409, "검증 이후 파일이 변경되었습니다. 다운로드를 차단했습니다.");
    }
    return new Response(bytes, { headers: { "content-type": artifact.contentType, "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(artifact.displayName)}`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch (error) { return apiFailure(error); }
}
