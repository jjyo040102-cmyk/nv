import { findTask, json, owner, responseError, taskArtifacts, verifiedBytes } from '@/lib/server';
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const userId = await owner(), { id } = await context.params;
    const task = await findTask(id, userId), files = await taskArtifacts(id, userId);
    const results = [];
    for (const file of files) { await verifiedBytes(file); results.push({ name: file.name, format: file.format, sha256: file.sha256, byteSize: file.byte_size, storedBytesMatch: true }); }
    return json({ type: 'actflow-evidence-v1', taskId: task.id, status: task.status, checkedAt: new Date().toISOString(), sample: Boolean(task.is_sample), files: results });
  } catch (error) { return responseError(error); }
}
