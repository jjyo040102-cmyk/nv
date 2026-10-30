import { z } from 'zod';
import { getRuntime } from '@/lib/api/runtime';
import { apiFailure,ApiError,json } from '@/lib/api/responses';
import { readJson } from '@/lib/api/schemas';
import { assertTaskAccess } from '@/lib/api/task-access';
import { resolveSessionActor } from '@/lib/security/session';
import { recordActivity } from '@/lib/audit/activity';
export const runtime='nodejs';
const Add=z.object({type:z.enum(['EMAIL','TIME','WEBHOOK','MANUAL']),config:z.record(z.string(),z.unknown()).default({}),enabled:z.boolean().optional(),nextDueAt:z.string().datetime().nullable().optional()}).strict();
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Context){try{const actor=await resolveSessionActor(request),{id}=await params,rt=getRuntime();assertTaskAccess(rt.db,id,actor);return json({triggers:rt.events.listTriggers(actor.sessionId,id)});}catch(error){return apiFailure(error);}}
export async function POST(request:Request,{params}:Context){try{
  const actor=await resolveSessionActor(request),{id}=await params,rt=getRuntime();assertTaskAccess(rt.db,id,actor);
  const task=rt.taskRepo.get(id,actor.sessionId)!;
  if(['COMPLETED','CANCELLED'].includes(task.status))throw new ApiError(409,'끝난 작업에는 예약을 추가할 수 없습니다.');
  const input=Add.parse(await readJson(request));
  if(input.type==='TIME'){
    if(!input.nextDueAt||new Date(input.nextDueAt).getTime()<=Date.now())throw new ApiError(400,'미래의 예약 시간을 선택하세요.');
    z.object({intervalMinutes:z.number().int().min(5).max(525600).optional()}).strict().parse(input.config);
    const existing=rt.events.listTriggers(actor.sessionId,id).find(t=>t.type==='TIME'&&t.enabled&&t.nextDueAt===input.nextDueAt&&JSON.stringify(t.configJson)===JSON.stringify(input.config));
    if(existing)return json({trigger:existing});
  }else if(input.nextDueAt)throw new ApiError(400,'시간 예약에만 시작 시간을 지정할 수 있습니다.');
  const trigger=rt.events.addTrigger({ownerSessionId:actor.sessionId,livingTaskId:id,type:input.type,configJson:input.config,enabled:input.enabled,nextDueAt:input.nextDueAt});
  recordActivity(rt.db,actor.sessionId,id,'TRIGGER_CREATED',{triggerId:trigger.id,type:trigger.type});
  return json({trigger},201);
}catch(error){return apiFailure(error);}}
export async function DELETE(request:Request,{params}:Context){try{
  const actor=await resolveSessionActor(request),{id}=await params,rt=getRuntime();assertTaskAccess(rt.db,id,actor);
  const input=z.object({triggerId:z.uuid()}).strict().parse(await readJson(request));
  if(rt.db.prepare('UPDATE trigger_subscriptions SET enabled=0,updated_at=? WHERE id=? AND living_task_id=? AND owner_session_id=?').run(new Date().toISOString(),input.triggerId,id,actor.sessionId).changes!==1)throw new ApiError(404,'예약을 찾지 못했습니다.');
  recordActivity(rt.db,actor.sessionId,id,'TRIGGER_DISABLED',{triggerId:input.triggerId});return json({disabled:true});
}catch(error){return apiFailure(error);}}
