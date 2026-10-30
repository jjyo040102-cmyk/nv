import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { participantsXlsx, responseDocx, sha256 } from './office';
import type { Participant, Task } from './task-types';

export class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export function responseError(error: unknown): Response {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
  console.error('ActFlow request failed', error);
  return Response.json({ error: 'The request could not be completed. Please try again.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
}
export function json(value: unknown, status = 200): Response { return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }); }
export async function owner(): Promise<string> {
  const user = await getChatGPTUser();
  if (!user) throw new HttpError(401, 'Sign in to open your workspace.');
  return user.userId;
}
export function sameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) throw new HttpError(403, 'This request is not from the workspace.');
}
export function db(): D1Database {
  if (!env.DB) throw new Error('D1 binding unavailable');
  return env.DB;
}
export function bucket(): R2Bucket {
  if (!env.BUCKET) throw new Error('R2 binding unavailable');
  return env.BUCKET;
}
export async function findTask(id: string, userId: string): Promise<Task> {
  const task = await db().prepare('SELECT * FROM tasks WHERE id = ? AND owner_id = ?').bind(id, userId).first<Task>();
  if (!task) throw new HttpError(404, 'Task not found.');
  return task;
}
function eventStatement(taskId: string, userId: string, kind: string, detail: string, now = new Date().toISOString()) {
  return db().prepare('INSERT INTO task_events (id, task_id, owner_id, kind, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), taskId, userId, kind, detail, now);
}
async function transition(task: Task, userId: string, from: string, to: string, kind: string, detail: string): Promise<void> {
  const now = new Date().toISOString();
  const result = await db().prepare('UPDATE tasks SET status=?, version=version+1, updated_at=? WHERE id=? AND owner_id=? AND status=? AND version=?')
    .bind(to, now, task.id, userId, from, task.version).run();
  if (!result.meta.changes) throw new HttpError(409, 'The task changed. Refresh and try again.');
  await eventStatement(task.id, userId, kind, detail, now).run();
}

type StoredArtifact = { id: string; task_id: string; owner_id: string; name: string; format: string; storage_key: string; sha256: string; byte_size: number; created_at: string };
export async function verifiedBytes(artifact: StoredArtifact): Promise<Uint8Array> {
  const object = await bucket().get(artifact.storage_key);
  if (!object) throw new HttpError(409, 'A generated file is unavailable.');
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength !== artifact.byte_size || await sha256(bytes) !== artifact.sha256) throw new HttpError(409, 'A generated file did not pass its integrity check.');
  return bytes;
}
export async function taskArtifacts(taskId: string, userId: string): Promise<StoredArtifact[]> {
  const result = await db().prepare('SELECT * FROM artifacts WHERE task_id=? AND owner_id=? ORDER BY created_at, name').bind(taskId, userId).all<StoredArtifact>();
  return result.results;
}

export async function generate(task: Task, userId: string, action: 'prepare' | 'approve' | 'retry'): Promise<void> {
  const expected = action === 'approve' ? 'WAITING_APPROVAL' : action === 'retry' ? 'FAILED' : 'DRAFT';
  if (task.status !== expected) throw new HttpError(409, 'This action is not available for the current task state.');
  if (action === 'prepare' && task.expense_krw >= 100000) {
    await transition(task, userId, 'DRAFT', 'WAITING_APPROVAL', 'APPROVAL_REQUESTED', `Travel expense review requested for KRW ${task.expense_krw.toLocaleString('en-US')}.`);
    return;
  }
  await transition(task, userId, expected, 'RUNNING', action === 'approve' ? 'APPROVED' : 'EXECUTION_STARTED', action === 'approve' ? 'The expense was approved for this task. No payment was made.' : 'Creating the requested review documents.');
  const written: string[] = [];
  try {
    const participants = JSON.parse(task.participants_json) as Participant[];
    const files = [
      { name: 'participants.xlsx', format: 'xlsx', bytes: participantsXlsx(participants) },
      { name: 'response-draft.docx', format: 'docx', bytes: responseDocx({ recipient: task.recipient, body: task.response_text, participants: participants.length, expenseKrw: task.expense_krw }) },
    ];
    const now = new Date().toISOString();
    const records = [] as Array<{ id: string; key: string; name: string; format: string; hash: string; size: number }>;
    for (const file of files) {
      const id = crypto.randomUUID(), key = `tasks/${task.id}/${id}`;
      const hash = await sha256(file.bytes);
      await bucket().put(key, file.bytes as Uint8Array<ArrayBuffer>, { httpMetadata: { contentType: file.format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } });
      written.push(key);
      const readBack = await bucket().get(key);
      if (!readBack) throw new Error('Uploaded file unavailable');
      const copied = new Uint8Array(await readBack.arrayBuffer());
      if (copied.length !== file.bytes.length || await sha256(copied) !== hash) throw new Error('Uploaded file failed hash verification');
      records.push({ id, key, name: file.name, format: file.format, hash, size: copied.length });
    }
    const statements = records.map(item => db().prepare('INSERT INTO artifacts (id,task_id,owner_id,name,format,storage_key,sha256,byte_size,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(item.id, task.id, userId, item.name, item.format, item.key, item.hash, item.size, now));
    statements.push(db().prepare("UPDATE tasks SET status='READY',version=version+1,updated_at=? WHERE id=? AND owner_id=? AND status='RUNNING'").bind(now, task.id, userId));
    statements.push(eventStatement(task.id, userId, 'FILES_VERIFIED', `Created ${records.length} files and verified their stored bytes with SHA-256.`, now));
    await db().batch(statements);
  } catch (error) {
    await Promise.allSettled(written.map(key => bucket().delete(key)));
    await db().batch([
      db().prepare("UPDATE tasks SET status='FAILED',version=version+1,updated_at=? WHERE id=? AND owner_id=? AND status='RUNNING'").bind(new Date().toISOString(), task.id, userId),
      eventStatement(task.id, userId, 'EXECUTION_FAILED', 'File creation did not finish; staged files were removed where possible.'),
    ]);
    throw error;
  }
}

export async function performAction(task: Task, userId: string, action: string, version: number, confirmed: boolean): Promise<void> {
  if (task.version !== version) throw new HttpError(409, 'The task changed. Refresh and try again.');
  if (action === 'approve' && !confirmed) throw new HttpError(409, 'Review and confirm the approval first.');
  if (action === 'prepare' || action === 'approve' || action === 'retry') return generate(task, userId, action);
  if (action === 'reject') {
    if (task.status !== 'WAITING_APPROVAL') throw new HttpError(409, 'There is no approval to reject.');
    return transition(task, userId, 'WAITING_APPROVAL', 'REJECTED', 'APPROVAL_REJECTED', 'The request was rejected. No files were created.');
  }
  if (action === 'complete') {
    if (task.status !== 'READY' || !confirmed) throw new HttpError(409, 'Review and confirm the generated files first.');
    const files = await taskArtifacts(task.id, userId);
    if (files.length !== 2) throw new HttpError(409, 'Both generated files are required.');
    for (const file of files) await verifiedBytes(file);
    await transition(task, userId, 'READY', 'COMPLETED', 'GOAL_CONFIRMED', 'The owner reviewed the results and confirmed completion.');
    await db().prepare('UPDATE tasks SET completed_at=? WHERE id=? AND owner_id=? AND status=?').bind(new Date().toISOString(), task.id, userId, 'COMPLETED').run();
    return;
  }
  throw new HttpError(400, 'Unknown task action.');
}
