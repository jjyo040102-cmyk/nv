import {afterEach,expect,it} from "vitest";
import type Database from "better-sqlite3";
import {openDatabase} from "../../lib/db";
import {runMigrations} from "../../lib/db/migrate";
import {LivingTaskRepository} from "../../lib/tasks/repository";
import {EventRepository} from "../../lib/events/repository";
import {WakeEngine} from "../../lib/events/wake-engine";

const dbs:Database.Database[]=[];
afterEach(()=>dbs.splice(0).forEach(db=>db.close()));

it("recovers and replays stale processing wake events",async()=>{
  const db=openDatabase({dataDir:".",dbPath:":memory:",demoAuth:true,maxUploadMb:25});dbs.push(db);runMigrations(db);
  const t=new LivingTaskRepository(db).create({ownerSessionId:"a",title:"t",goal:"g",status:"WAITING_EVENT"});
  const r=new EventRepository(db);
  const tr=r.addTrigger({ownerSessionId:"a",livingTaskId:t.id,type:"WEBHOOK",configJson:{}});
  const ev=r.recordEvent({triggerId:tr.id,ownerSessionId:"a",eventKey:"x",type:"WEBHOOK",payloadJson:{value:1}}).event;
  r.claimEvent(ev.id,"old",new Date("2026-01-01T00:00:00Z"));
  const engine=new WakeEngine(db,r);let resumed=0;
  engine.setResumeHandler(async(taskId,ownerSessionId,wakeEventId)=>{expect(taskId).toBe(t.id);expect(ownerSessionId).toBe("a");expect(wakeEventId).toBe(ev.id);resumed++;});
  expect(await engine.recoverInterruptedEvents(new Date("2026-01-01T00:10:00Z"),60_000)).toBe(1);
  expect(r.getEvent(ev.id)?.status).toBe("PENDING");
  expect(await engine.processPendingEvents()).toBe(1);
  expect(resumed).toBe(1);
  expect(r.getEvent(ev.id)?.status).toBe("PROCESSED");
});


it("maintenance replay ignores failed events and only replays pending ones",async()=>{
  const db=openDatabase({dataDir:".",dbPath:":memory:",demoAuth:true,maxUploadMb:25});dbs.push(db);runMigrations(db);
  const t=new LivingTaskRepository(db).create({ownerSessionId:"a",title:"t",goal:"g",status:"WAITING_EVENT"});
  const r=new EventRepository(db);
  const tr=r.addTrigger({ownerSessionId:"a",livingTaskId:t.id,type:"WEBHOOK",configJson:{}});
  const ev=r.recordEvent({triggerId:tr.id,ownerSessionId:"a",eventKey:"failed",type:"WEBHOOK",payloadJson:{}}).event;
  expect(r.claimEvent(ev.id,"worker")).toBe(true);
  r.failEvent(ev.id,"boom");
  const engine=new WakeEngine(db,r);let resumed=0;engine.setResumeHandler(async()=>{resumed++;});
  expect(await engine.processPendingEvents()).toBe(0);
  expect(resumed).toBe(0);
  expect(r.getEvent(ev.id)?.status).toBe("FAILED");
});

it("does not erase waiting reason or mutate protected task state when a wake event arrives",async()=>{
  const db=openDatabase({dataDir:".",dbPath:":memory:",demoAuth:true,maxUploadMb:25});dbs.push(db);runMigrations(db);
  const repo=new LivingTaskRepository(db);
  const created=repo.create({ownerSessionId:"a",title:"t",goal:"g",status:"WAITING_APPROVAL"});
  const t=repo.update(created.id,"a",created.version,{waitingReason:"사용자 승인 대기"});
  const r=new EventRepository(db);
  const tr=r.addTrigger({ownerSessionId:"a",livingTaskId:t.id,type:"WEBHOOK",configJson:{}});
  const engine=new WakeEngine(db,r);let resumed=0;engine.setResumeHandler(async()=>{resumed++;});
  const result=await engine.ingest({triggerId:tr.id,ownerSessionId:"a",eventKey:"protected",type:"WEBHOOK",payloadJson:{}});
  const after=repo.get(t.id,"a")!;
  expect(after.status).toBe("WAITING_APPROVAL");
  expect(after.waitingReason).toBe("사용자 승인 대기");
  expect(resumed).toBe(0);
  expect(result.woke).toBe(false);
});
