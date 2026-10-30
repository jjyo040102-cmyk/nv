import { z } from 'zod';
import { db, HttpError, json, owner, responseError, sameOrigin } from '@/lib/server';

const inputSchema = z.object({
  requestId: z.string().uuid(),
  goal: z.string().trim().min(1).max(20000),
  sourceName: z.string().trim().max(200),
  sourceText: z.string().max(100000),
  participants: z.array(z.object({ id: z.string().trim().min(1).max(60), name: z.string().trim().min(1).max(100), department: z.string().trim().max(100), role: z.string().trim().max(100) }).strict()).min(1).max(200),
  recipient: z.string().trim().min(1).max(200),
  responseText: z.string().trim().min(1).max(10000),
  expenseKrw: z.number().int().nonnegative().max(1000000000),
  isSample: z.boolean(),
}).strict();

export async function GET() {
  try {
    const userId = await owner();
    const result = await db().prepare('SELECT id,title,goal,status,version,is_sample,created_at,updated_at,completed_at FROM tasks WHERE owner_id=? ORDER BY updated_at DESC LIMIT 200').bind(userId).all();
    return json({ tasks: result.results });
  } catch (error) { return responseError(error); }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const userId = await owner();
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) throw new HttpError(400, 'Check the goal, participant details, response draft, and expense amount.');
    const input = parsed.data, ids = input.participants.map(person => person.id.toLocaleLowerCase());
    if (new Set(ids).size !== ids.length) throw new HttpError(400, 'Each participant needs a unique employee ID.');
    const now = new Date().toISOString();
    await db().batch([
      db().prepare(`INSERT OR IGNORE INTO tasks (id,owner_id,title,goal,source_name,source_text,participants_json,recipient,response_text,expense_krw,is_sample,status,version,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'DRAFT',1,?,?)`).bind(input.requestId, userId, input.goal.length > 80 ? `${input.goal.slice(0, 77)}…` : input.goal, input.goal, input.sourceName || 'Text provided', input.sourceText, JSON.stringify(input.participants), input.recipient, input.responseText, input.expenseKrw, input.isSample ? 1 : 0, now, now),
      db().prepare('INSERT OR IGNORE INTO task_events (id,task_id,owner_id,kind,detail,created_at) SELECT ?,id,owner_id,?,?,? FROM tasks WHERE id=? AND owner_id=?')
        .bind(`created-${input.requestId}`, 'TASK_CREATED', 'Task created with the supplied goal and review details.', now, input.requestId, userId),
    ]);
    const created = await db().prepare('SELECT id FROM tasks WHERE id=? AND owner_id=?').bind(input.requestId, userId).first();
    if (!created) throw new HttpError(409, 'This request could not be created.');
    return json({ id: input.requestId }, 201);
  } catch (error) { return responseError(error); }
}
