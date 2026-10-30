import {resolveDataScope} from "../security/data-scope";
import { randomUUID } from "node:crypto";import type Database from "better-sqlite3";import type { MemoryEntryRecord, MemoryScope } from "./types";
type Row={id:string;owner_session_id:string;project_id:string|null;living_task_id:string|null;scope:MemoryScope;memory_key:string;value_json:string;summary:string;source_type:string;source_id:string;confidence:number;active:number;supersedes_id:string|null;created_at:string;updated_at:string};
const map=(r:Row):MemoryEntryRecord=>({id:r.id,ownerSessionId:r.owner_session_id,projectId:r.project_id,livingTaskId:r.living_task_id,scope:r.scope,key:r.memory_key,valueJson:JSON.parse(r.value_json),summary:r.summary,sourceType:r.source_type,sourceId:r.source_id,confidence:r.confidence,active:r.active===1,supersedesId:r.supersedes_id,createdAt:r.created_at,updatedAt:r.updated_at});
export type MemoryAppendInput={id?:string;ownerSessionId:string;projectId?:string|null;livingTaskId?:string|null;scope:MemoryScope;key:string;valueJson:unknown;summary:string;sourceType:string;sourceId:string;confidence:number;supersedesId?:string|null};
export class MemoryRepository{constructor(private readonly db:Database.Database){}
 append(input:MemoryAppendInput):MemoryEntryRecord{if(!input.sourceType.trim()||!input.sourceId.trim())throw new Error("Memory provenance is required");
 const resolved=resolveDataScope(this.db,input);
 if(input.scope==="USER"&&(resolved.projectId||resolved.livingTaskId))throw new Error("User memory cannot carry project/task data");
 if(input.scope==="PROJECT"&&(!resolved.projectId||resolved.livingTaskId))throw new Error("Project memory needs only a project scope");
 if(input.scope==="TASK"&&!resolved.livingTaskId)throw new Error("Task memory needs a task");
 if(!Number.isFinite(input.confidence)||input.confidence<0||input.confidence>1)throw new Error("Invalid memory confidence");
 input={...input,...resolved};const id=input.id??randomUUID(),now=new Date().toISOString();this.db.prepare(`INSERT INTO memory_entries(id,owner_session_id,project_id,living_task_id,scope,memory_key,value_json,summary,source_type,source_id,confidence,active,supersedes_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`).run(id,input.ownerSessionId,input.projectId??null,input.livingTaskId??null,input.scope,input.key,JSON.stringify(input.valueJson),input.summary,input.sourceType,input.sourceId,input.confidence,input.supersedesId??null,now,now);return this.get(id)!;}
 private get(id:string):MemoryEntryRecord|null{const r=this.db.prepare("SELECT * FROM memory_entries WHERE id=?").get(id) as Row|undefined;return r?map(r):null;}
 listActive(q:{ownerSessionId:string;projectId?:string;livingTaskId?:string;scope?:MemoryScope}):MemoryEntryRecord[]{let sql="SELECT * FROM memory_entries WHERE owner_session_id=? AND active=1",args:any[]=[q.ownerSessionId];if(q.projectId){sql+=" AND project_id=?";args.push(q.projectId);}if(q.livingTaskId){sql+=" AND living_task_id=?";args.push(q.livingTaskId);}if(q.scope){sql+=" AND scope=?";args.push(q.scope);}sql+=" ORDER BY updated_at DESC";return (this.db.prepare(sql).all(...args) as Row[]).map(map);}
 listHistory(q:{ownerSessionId:string;key?:string}):MemoryEntryRecord[]{let sql="SELECT * FROM memory_entries WHERE owner_session_id=?",args:any[]=[q.ownerSessionId];if(q.key){sql+=" AND memory_key=?";args.push(q.key);}sql+=" ORDER BY created_at";return (this.db.prepare(sql).all(...args) as Row[]).map(map);}
 supersede(oldId:string,newEntry:MemoryAppendInput):MemoryEntryRecord{return this.db.transaction(()=>{const old=this.get(oldId);if(!old||old.ownerSessionId!==newEntry.ownerSessionId)throw new Error("Memory not found");
 const scope=resolveDataScope(this.db,newEntry);
 if(!old.active||old.projectId!==scope.projectId||old.livingTaskId!==scope.livingTaskId||old.scope!==newEntry.scope||old.key!==newEntry.key)throw new Error("Memory supersession scope conflict");this.db.prepare("UPDATE memory_entries SET active=0,updated_at=? WHERE id=?").run(new Date().toISOString(),oldId);return this.append({...newEntry,supersedesId:oldId});})();}
 listForPlanning(q:{ownerSessionId:string;projectId?:string;livingTaskId?:string;limit?:number}):MemoryEntryRecord[]{
 const scope=resolveDataScope(this.db,q);
 const all=this.listActive({ownerSessionId:q.ownerSessionId});
 return all.filter(m=>{
   if(!q.projectId&&!q.livingTaskId)return true;
   if(m.scope==="USER")return !m.projectId&&!m.livingTaskId;
   if(q.livingTaskId)return m.livingTaskId===q.livingTaskId&&m.projectId===scope.projectId || !m.livingTaskId&&scope.projectId!==null&&m.projectId===scope.projectId;
   return m.projectId===scope.projectId;
 }).slice(0,Math.max(1,Math.min(q.limit??50,100)));
 }
}
