import { getRuntime } from '@/lib/api/runtime';
import { assertTaskAccess } from '@/lib/api/task-access';
import { apiFailure,json } from '@/lib/api/responses';
import { resolveSessionActor } from '@/lib/security/session';
import { reconcileGmailSend } from '@/lib/email/reconcile';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  try{const actor=await resolveSessionActor(request),{id}=await params,app=getRuntime();assertTaskAccess(app.db,id,actor);return json(await reconcileGmailSend(app.db,app.gmailClient,app.config.dataDir,id,actor));}
  catch(error){return apiFailure(error);}
}
