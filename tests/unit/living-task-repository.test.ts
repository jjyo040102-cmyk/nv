import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../lib/db";
import { runMigrations } from "../../lib/db/migrate";
import { ProjectRepository } from "../../lib/tasks/project-repository";
import { LivingTaskRepository } from "../../lib/tasks/repository";
const databases: Database.Database[]=[]; afterEach(()=>{for(const db of databases.splice(0))db.close();});
function setup(){const db=openDatabase({dataDir:".",dbPath:":memory:",demoAuth:true,maxUploadMb:25}); databases.push(db);runMigrations(db);return {db,projects:new ProjectRepository(db),tasks:new LivingTaskRepository(db)};}
describe("living task repositories",()=>{
 it("isolates owners and rejects stale versions",()=>{const {projects,tasks}=setup();const p=projects.create({ownerSessionId:"a",name:"Project"});expect(projects.get(p.id,"b")).toBeNull();const t=tasks.create({ownerSessionId:"a",projectId:p.id,title:"Work",goal:"Do work"});expect(tasks.get(t.id,"b")).toBeNull();expect(()=>tasks.update(t.id,"a",99,{title:"bad"})).toThrow(/version/i);expect(tasks.update(t.id,"a",0,{status:"READY"}).status).toBe("READY");});
 it("cannot attach a task to another owner's project",()=>{const {projects,tasks}=setup();const p=projects.create({ownerSessionId:"a",name:"A"});expect(()=>tasks.create({ownerSessionId:"b",projectId:p.id,title:"bad",goal:"bad"})).toThrow(/project/i);});
});
