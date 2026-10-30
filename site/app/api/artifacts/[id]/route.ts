import { db, HttpError, owner, responseError, verifiedBytes } from '@/lib/server';

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const userId = await owner(), { id } = await context.params;
    const artifact = await db().prepare('SELECT * FROM artifacts WHERE id=? AND owner_id=?').bind(id, userId).first<any>();
    if (!artifact) throw new HttpError(404, 'File not found.');
    const bytes = await verifiedBytes(artifact);
    return new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { 'Content-Type': artifact.format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': `attachment; filename="${artifact.format === 'xlsx' ? 'participants.xlsx' : 'response-draft.docx'}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return responseError(error); }
}
