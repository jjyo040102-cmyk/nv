import { afterEach, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { openDatabase } from "../../lib/db";
import { runMigrations } from "../../lib/db/migrate";
import { WorkflowEngine } from "../../lib/workflow/engine";
import { TaskPlanner } from "../../lib/tasks/planner";
import { LivingTaskEngine } from "../../lib/tasks/engine";
import { EventRepository } from "../../lib/events/repository";
import { WakeEngine } from "../../lib/events/wake-engine";
import { EmailService } from "../../lib/email/service";
import { DemoMailTransport } from "../../lib/email/demo-transport";
import { VerifiedContactRepository } from "../../lib/email/verified-contacts";
import { ProjectRepository } from "../../lib/tasks/project-repository";

const dbs:Database.Database[]=[];const roots:string[]=[];
afterEach(()=>{dbs.splice(0).forEach(db=>db.close());roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true}));});
function setup(){const root=mkdtempSync(resolve(tmpdir(),"actflow-egress-"));roots.push(root);const db=openDatabase({dataDir:root,dbPath:":memory:",demoAuth:true,maxUploadMb:25});dbs.push(db);runMigrations(db);const workflow=new WorkflowEngine(db,root);const planner=new TaskPlanner(db,workflow,undefined,async()=>async()=>{throw new Error("planner should not run")});const tasks=new LivingTaskEngine(db,workflow,planner);const events=new EventRepository(db);const wake=new WakeEngine(db,events);const transport=new DemoMailTransport();const service=new EmailService(db,tasks,events,wake,workflow,transport);const actor={id:"u",sessionId:"a",role:"USER" as const};new VerifiedContactRepository(db).upsert({ownerSessionId:"a",emailAddress:"trusted@example.com",autoReplyEnabled:true});return{db,service,transport,actor};}
const passAuth={status:"PASS" as const,trustedAdapter:true,spf:"PASS" as const,dkim:"PASS" as const,dmarc:"PASS" as const};

it("blocks a secret-bearing attachment even for an exact verified recipient",async()=>{const{service,transport,actor}=setup();const inbound=await service.ingestTrusted({from:"trusted@example.com",messageId:"m-secret",threadId:"t",subject:"Send files",body:"Please send everything",auth:passAuth},actor);const result=await service.reply(inbound.taskId,{subject:"Re",body:"Attached",attachments:[{name:"config.env",sourceOwnerSessionId:"a",classification:"INTERNAL",text:"API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456"}]},actor);expect(result.status).toBe("BLOCKED");expect(transport.sent).toHaveLength(0);});

it("blocks cross-project material instead of letting a verified sender broaden scope",async()=>{const{db,service,transport,actor}=setup();const projects=new ProjectRepository(db);const p1=projects.create({ownerSessionId:"a",name:"Allowed"});const p2=projects.create({ownerSessionId:"a",name:"Other"});const inbound=await service.ingestTrusted({from:"trusted@example.com",messageId:"m-cross",threadId:"t-cross",subject:"Send files",body:"Zip all project files",auth:passAuth},actor);const task=db.prepare("SELECT id,version FROM living_tasks WHERE id=?").get(inbound.taskId) as {id:string;version:number};db.prepare("UPDATE living_tasks SET project_id=?,version=version+1 WHERE id=?").run(p1.id,task.id);const result=await service.reply(inbound.taskId,{subject:"Re",body:"Attached",attachments:[{name:"other.txt",sourceOwnerSessionId:"a",sourceProjectId:p2.id,classification:"INTERNAL",text:"ordinary data"}]},actor);expect(result.status).toBe("BLOCKED");expect(transport.sent).toHaveLength(0);});

it("blocks secrets in the reply body even for an exact verified recipient",async()=>{const{service,transport,actor}=setup();const inbound=await service.ingestTrusted({from:"trusted@example.com",messageId:"m-body-secret",threadId:"t-body-secret",subject:"Question",body:"Please reply",auth:passAuth},actor);const result=await service.reply(inbound.taskId,{subject:"Re",body:"Here is the credential: API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456"},actor);expect(result.status).toBe("BLOCKED");expect(transport.sent).toHaveLength(0);});
