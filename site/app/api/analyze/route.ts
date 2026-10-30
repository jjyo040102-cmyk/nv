import { z } from 'zod';
import { analyzeDocument } from '@/lib/provider';
import { HttpError, json, owner, responseError, sameOrigin } from '@/lib/server';
export async function POST(request: Request) {
  try {
    sameOrigin(request); const userId = await owner();
    const parsed = z.object({ goal: z.string().trim().min(1).max(20000), sourceText: z.string().trim().min(1).max(50000) }).strict().safeParse(await request.json());
    if (!parsed.success) throw new HttpError(400, 'Add a goal and source text to analyze.');
    return json(await analyzeDocument(userId, parsed.data.goal, parsed.data.sourceText));
  } catch (error) { return responseError(error); }
}
