import { getRuntime } from '@/lib/api/runtime';
import { apiFailure,json } from '@/lib/api/responses';
import { resolveSessionActor } from '@/lib/security/session';
import { ModelSettingsRepository } from '@/lib/providers/model-settings';
export const runtime='nodejs';
export async function GET(request:Request){try{
  const actor=await resolveSessionActor(request),app=getRuntime();
  const worker=app.db.prepare('SELECT last_tick_at,last_error FROM worker_health WHERE id=1').get() as {last_tick_at:string;last_error:string|null}|undefined;
  return json({authentication:app.config.demoAuth?'development':'account',inference:{...new ModelSettingsRepository(app.db).get(actor.sessionId),credentialSaved:app.credentials.getMetadata(actor.sessionId,'nebius').saved,liveCheck:"use-connection-test"},gmail:app.gmail.status(actor.sessionId),worker:{enabled:process.env.ACTFLOW_WORKER_ENABLED!=='false',lastTickAt:worker?.last_tick_at??null,lastError:worker?.last_error??null,healthy:Boolean(worker&&!worker.last_error&&Date.now()-new Date(worker.last_tick_at).getTime()<180000)}});
}catch(error){return apiFailure(error);}}
