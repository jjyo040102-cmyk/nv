import { z } from 'zod';
import { db, HttpError, json, owner, responseError, sameOrigin } from '@/lib/server';
import { defaultModel, saveProvider, validModel } from '@/lib/provider';

export async function GET() {
  try { const userId = await owner(); const row = await db().prepare('SELECT model,updated_at FROM provider_settings WHERE owner_id=?').bind(userId).first<{ model: string; updated_at: string }>(); return json({ connected: Boolean(row), model: row?.model ?? defaultModel, updatedAt: row?.updated_at ?? null }); }
  catch (error) { return responseError(error); }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request); const userId = await owner();
    const parsed = z.object({ model: z.string().max(150), apiKey: z.string().min(8).max(2048) }).strict().safeParse(await request.json());
    if (!parsed.success || !validModel(parsed.data.model)) throw new HttpError(400, 'Check the model and connection details.');
    await saveProvider(userId, parsed.data.model, parsed.data.apiKey);
    return json({ saved: true, model: parsed.data.model });
  } catch (error) { return responseError(error); }
}
export async function DELETE(request: Request) {
  try { sameOrigin(request); const userId = await owner(); await db().prepare('DELETE FROM provider_settings WHERE owner_id=?').bind(userId).run(); return json({ removed: true }); }
  catch (error) { return responseError(error); }
}
