import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { ProjectRecord, ProjectStatus } from "./types";
type Row={id:string;owner_session_id:string;name:string;status:ProjectStatus;summary:string|null;version:number;created_at:string;updated_at:string};
const map=(r:Row):ProjectRecord=>({id:r.id,ownerSessionId:r.owner_session_id,name:r.name,status:r.status,summary:r.summary,version:r.version,createdAt:r.created_at,updatedAt:r.updated_at});
export class ProjectRepository { constructor(private readonly db:Database.Database){}
 create(input:{id?:string;ownerSessionId:string;name:string;summary?:string|null;status?:ProjectStatus}):ProjectRecord{const id=input.id??randomUUID(),now=new Date().toISOString();this.db.prepare("INSERT INTO projects(id,owner_session_id,name,status,summary,version,created_at,updated_at) VALUES (?,?,?,?,?,0,?,?)").run(id,input.ownerSessionId,input.name,input.status??"ACTIVE",input.summary??null,now,now);return this.get(id,input.ownerSessionId)!;}
 get(id:string,ownerSessionId:string):ProjectRecord|null{const r=this.db.prepare("SELECT * FROM projects WHERE id=? AND owner_session_id=?").get(id,ownerSessionId) as Row|undefined;return r?map(r):null;}
 list(ownerSessionId:string):ProjectRecord[]{return (this.db.prepare("SELECT * FROM projects WHERE owner_session_id=? ORDER BY updated_at DESC").all(ownerSessionId) as Row[]).map(map);}
 update(id:string,ownerSessionId:string,expectedVersion:number,patch:Partial<Pick<ProjectRecord,"name"|"status"|"summary">>):ProjectRecord{const cur=this.get(id,ownerSessionId);if(!cur)throw new Error("Project not found");const next={...cur,...patch};const result=this.db.prepare("UPDATE projects SET name=?,status=?,summary=?,version=version+1,updated_at=? WHERE id=? AND owner_session_id=? AND version=?").run(next.name,next.status,next.summary,new Date().toISOString(),id,ownerSessionId,expectedVersion);if(result.changes!==1)throw new Error("Project version conflict");return this.get(id,ownerSessionId)!;}
}
