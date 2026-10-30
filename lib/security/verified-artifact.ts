import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open,realpath } from 'node:fs/promises';
import { resolve,sep } from 'node:path';
import type Database from 'better-sqlite3';
import { resolveWorkspacePath } from '../artifacts/workspace';
import { resolveDataScope } from './data-scope';
import { AuthorizationError } from '../auth/roles';
import type { OutgoingItem } from './data-guard';
export async function readVerifiedArtifact(db:Database.Database,root:string,input:{artifactId:string;ownerSessionId:string;livingTaskId:string}):Promise<OutgoingItem&{artifactId:string;sha256:string}>{
  const scope=resolveDataScope(db,input);
  const row=db.prepare(`SELECT a.*,w.owner_session_id,w.living_task_id,t.project_id FROM artifacts a JOIN workflows w ON w.id=a.workflow_id
    LEFT JOIN living_tasks t ON t.id=w.living_task_id AND t.owner_session_id=w.owner_session_id WHERE a.id=? AND w.owner_session_id=?`).get(input.artifactId,input.ownerSessionId) as {id:string;workflow_id:string;living_task_id:string|null;project_id:string|null;display_name:string;relative_path:string;state:string;verification_status:string;sha256:string;byte_size:number;content_type:string}|undefined;
  if(!row||row.project_id!==scope.projectId||scope.projectId===null&&row.living_task_id!==input.livingTaskId)throw new AuthorizationError('첨부파일의 프로젝트 또는 작업 범위가 일치하지 않습니다.');
  if(row.state!=='COMMITTED'||row.verification_status!=='VERIFIED'||!row.sha256||row.byte_size<0||row.byte_size>25*1024*1024)throw new Error('Attachment is not a verified bounded artifact');
  const parts=row.relative_path.split('/');if(parts.length!==3||parts[0]!==row.workflow_id||parts[1]!=='committed')throw new Error('Invalid artifact path');
  const path=resolveWorkspacePath(root,row.workflow_id,'committed',parts[2]),base=await realpath(resolve(root));
  const canonical=await realpath(path);if(!canonical.startsWith(base+sep))throw new Error('Artifact escaped workspace');
  const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  let bytes:Buffer;
  try{
    const stat=await file.stat();if(!stat.isFile()||stat.size!==row.byte_size)throw new Error('Artifact size changed');
    bytes=Buffer.alloc(row.byte_size);let offset=0;
    while(offset<bytes.length){const part=await file.read(bytes,offset,bytes.length-offset,offset);if(!part.bytesRead)throw new Error('Artifact truncated');offset+=part.bytesRead;}
    const extra=Buffer.alloc(1);if((await file.read(extra,0,1,offset)).bytesRead!==0)throw new Error('Artifact grew during verification');
  }finally{await file.close();}
  if(createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw new Error('Artifact content changed');
  return {artifactId:row.id,sha256:row.sha256,name:row.display_name,sourceOwnerSessionId:input.ownerSessionId,sourceProjectId:row.project_id,classification:'INTERNAL',buffer:bytes,contentType:row.content_type};
}
