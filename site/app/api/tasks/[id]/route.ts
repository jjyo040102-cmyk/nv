import { z } from 'zod';
import { db, findTask, HttpError, json, owner, performAction, responseError, sameOrigin, taskArtifacts } from '@/lib/server';

type Context = { params: Promise<{ id: string }> };
const actionSchema = z.object({ action: z.enum(['prepare', 'approve', 'reject', 'complete', 'retry']), version: z.number().int().positive(), confirmed: z.boolean().optional().default(false) }).strict();

export async function GET(_request: Request, context: Context) {
  try {
    const userId = await owner(), { id } = await context.params;
    const task = await findTask(id, userId);
    const [events, files] = await Promise.all([
      db().prepare('SELECT id,kind,detail,created_at FROM task_events WHERE task_id=? AND owner_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100').bind(id, userId).all(),
      taskArtifacts(id, userId),
    ]);
    return json({ task, events: events.results, artifacts: files.map(({ id, name, format, sha256, byte_size, created_at }) => ({ id, name, format, sha256, byte_size, created_at })) });
  } catch (error) { return responseError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const userId = await owner(), { id } = await context.params;
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) throw new HttpError(400, 'Choose a valid task action.');
    const task = await findTask(id, userId);
    await performAction(task, userId, parsed.data.action, parsed.data.version, parsed.data.confirmed);
    return json({ ok: true });
  } catch (error) { return responseError(error); }
}
