import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { AuthorizationError } from '../auth/roles';
import { DomainError } from '../domain/errors';
export class TaskConflictError extends DomainError { constructor(message='이 작업은 다른 실행에서 처리 중입니다.'){super('TASK_CONFLICT',message);this.name='TaskConflictError';} }
type Lease={db:Database.Database;taskId:string;ownerSessionId:string;token:string};
const context=new AsyncLocalStorage<Lease>();
export function assertTaskLease(db:Database.Database,taskId:string):void {
  const lease=context.getStore();
  if(!lease||lease.db!==db||lease.taskId!==taskId)throw new TaskConflictError('작업 실행 잠금이 없습니다.');
  const row=db.prepare('SELECT lease_owner,lease_expires_at FROM living_tasks WHERE id=? AND owner_session_id=?').get(taskId,lease.ownerSessionId) as {lease_owner:string|null;lease_expires_at:string|null}|undefined;
  if(!row||row.lease_owner!==lease.token||!row.lease_expires_at||row.lease_expires_at<=new Date().toISOString())throw new TaskConflictError('작업 실행 잠금이 만료되었습니다. 다시 실행하기 전에 상태를 확인하세요.');
}
export async function withTaskLease<T>(db:Database.Database,taskId:string,ownerSessionId:string,operation:()=>Promise<T>):Promise<T>{
  const existing=context.getStore();
  if(existing&&existing.db===db&&existing.taskId===taskId&&existing.ownerSessionId===ownerSessionId){assertTaskLease(db,taskId);return operation();}
  const token=`task:${randomUUID()}`,ttl=120_000,now=new Date();
  if(!db.prepare('SELECT 1 FROM living_tasks WHERE id=? AND owner_session_id=?').get(taskId,ownerSessionId))throw new AuthorizationError();
  const claimed=db.prepare('UPDATE living_tasks SET lease_owner=?,lease_expires_at=? WHERE id=? AND owner_session_id=? AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at<=?)')
    .run(token,new Date(now.getTime()+ttl).toISOString(),taskId,ownerSessionId,now.toISOString());
  if(claimed.changes!==1)throw new TaskConflictError();
  const heartbeat=setInterval(()=>{
    try{const current=new Date();db.prepare('UPDATE living_tasks SET lease_expires_at=? WHERE id=? AND owner_session_id=? AND lease_owner=? AND lease_expires_at>?')
      .run(new Date(current.getTime()+ttl).toISOString(),taskId,ownerSessionId,token,current.toISOString());}catch{/* Boundary checks fail closed if the database/lease is lost. */}
  },20_000);heartbeat.unref?.();
  try{return await context.run({db,taskId,ownerSessionId,token},async()=>{const result=await operation();assertTaskLease(db,taskId);return result;});}
  finally{clearInterval(heartbeat);db.prepare('UPDATE living_tasks SET lease_owner=NULL,lease_expires_at=NULL WHERE id=? AND owner_session_id=? AND lease_owner=?').run(taskId,ownerSessionId,token);}
}
