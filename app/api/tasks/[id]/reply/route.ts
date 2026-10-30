import {z} from 'zod';
import {getRuntime} from '@/lib/api/runtime';
import {apiFailure,json} from '@/lib/api/responses';
import {readJson} from '@/lib/api/schemas';
import {resolveSessionActor} from '@/lib/security/session';
import {assertTaskAccess} from '@/lib/api/task-access';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{
  const actor=await resolveSessionActor(request),{id}=await params,app=getRuntime();assertTaskAccess(app.db,id,actor);
  const draft=z.object({subject:z.string().trim().min(1).max(500),body:z.string().min(1).max(20000),artifactIds:z.array(z.string().uuid()).max(50).optional(),bulkExport:z.boolean().optional()}).strict().parse(await readJson(request));
  return json({reply:await app.email.reply(id,draft,actor)});
}catch(error){return apiFailure(error);}}
