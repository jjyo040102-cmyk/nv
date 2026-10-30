import { afterEach, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../lib/db";
import { runMigrations } from "../../lib/db/migrate";
import { LivingTaskRepository } from "../../lib/tasks/repository";
import { ProjectRepository } from "../../lib/tasks/project-repository";
import { assertTaskAccess, assertProjectAccess } from "../../lib/api/task-access";

const dbs:Database.Database[]=[];afterEach(()=>dbs.splice(0).forEach(db=>db.close()));
it("rejects known project/task ids owned by another session",()=>{const db=openDatabase({dataDir:".",dbPath:":memory:",demoAuth:true,maxUploadMb:25});dbs.push(db);runMigrations(db);const project=new ProjectRepository(db).create({ownerSessionId:"owner-a",name:"Private"});const task=new LivingTaskRepository(db).create({ownerSessionId:"owner-a",projectId:project.id,title:"T",goal:"G"});expect(()=>assertProjectAccess(db,project.id,{id:"u",sessionId:"owner-b",role:"USER"})).toThrow();expect(()=>assertTaskAccess(db,task.id,{id:"u",sessionId:"owner-b",role:"USER"})).toThrow();});
