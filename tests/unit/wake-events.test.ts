import {afterEach,describe,expect,it} from "vitest";
import type Database from "better-sqlite3";
import {openDatabase} from "../../lib/db";
import {runMigrations} from "../../lib/db/migrate";
import {LivingTaskRepository} from "../../lib/tasks/repository";
import {EventRepository} from "../../lib/events/repository";
import {TriggerScheduler} from "../../lib/events/scheduler";
import {WakeEngine} from "../../lib/events/wake-engine";

const dbs:Database.Database[]=[];
afterEach(()=>dbs.splice(0).forEach(db=>db.close()));
function setup(){
  const db=openDatabase({dataDir:".",dbPath:":memory:",demoAuth:true,maxUploadMb:25});
  dbs.push(db);runMigrations(db);
  const t=new LivingTaskRepository(db).create({ownerSessionId:"a",title:"t",goal:"g",status:"WAITING_EVENT"});
  return{db,t,events:new EventRepository(db)};
}

describe("wake event durability",()=>{
  it("deduplicates trigger/event keys",()=>{
    const {t,events}=setup();
    const trigger=events.addTrigger({ownerSessionId:"a",livingTaskId:t.id,type:"WEBHOOK",configJson:{}});
    const a=events.recordEvent({triggerId:trigger.id,ownerSessionId:"a",eventKey:"same",type:"WEBHOOK",payloadJson:{x:1}});
    const b=events.recordEvent({triggerId:trigger.id,ownerSessionId:"a",eventKey:"same",type:"WEBHOOK",payloadJson:{x:2}});
    expect(a.event.id).toBe(b.event.id);expect(b.duplicate).toBe(true);
  });

  it("refuses events for a disabled trigger",()=>{
    const {t,events}=setup();
    const trigger=events.addTrigger({ownerSessionId:"a",livingTaskId:t.id,type:"WEBHOOK",configJson:{},enabled:false});
    expect(()=>events.recordEvent({triggerId:trigger.id,ownerSessionId:"a",eventKey:"blocked",type:"WEBHOOK",payloadJson:{}})).toThrow(/disabled/i);
  });

  it("leases one worker and allows expiry recovery",()=>{
    const {t,events}=setup();
    expect(events.acquireTaskLease(t.id,"one",1000,new Date("2026-01-01T00:00:00Z"))).toBe(true);
    expect(events.acquireTaskLease(t.id,"two",1000,new Date("2026-01-01T00:00:00.500Z"))).toBe(false);
    expect(events.acquireTaskLease(t.id,"two",1000,new Date("2026-01-01T00:00:02Z"))).toBe(true);
    expect(events.releaseTaskLease(t.id,"one")).toBe(false);
    expect(events.releaseTaskLease(t.id,"two")).toBe(true);
  });


  it("preserves approval, blocked, and paused task states when an event arrives",async()=>{
    for(const status of ["WAITING_APPROVAL","BLOCKED","PAUSED"] as const){
      const {t,events,db}=setup();
      db.prepare("UPDATE living_tasks SET status=? WHERE id=?").run(status,t.id);
      const trigger=events.addTrigger({ownerSessionId:"a",livingTaskId:t.id,type:"WEBHOOK",configJson:{}});
      const wake=new WakeEngine(db,events);
      let resumed=0;wake.setResumeHandler(async()=>{resumed++;});
      const result=await wake.ingest({triggerId:trigger.id,ownerSessionId:"a",eventKey:`state-${status}`,type:"WEBHOOK",payloadJson:{}});
      expect(result.woke).toBe(false);
      expect(resumed).toBe(0);
      expect(new LivingTaskRepository(db).get(t.id,"a")?.status).toBe(status);
    }
  });

  it("does not automatically retry a previously failed wake event",async()=>{
    const {t,events,db}=setup();
    const trigger=events.addTrigger({ownerSessionId:"a",livingTaskId:t.id,type:"WEBHOOK",configJson:{}});
    const first=events.recordEvent({triggerId:trigger.id,ownerSessionId:"a",eventKey:"failed-once",type:"WEBHOOK",payloadJson:{}}).event;
    expect(events.claimEvent(first.id,"worker")).toBe(true);
    events.failEvent(first.id,"boom");
    const wake=new WakeEngine(db,events);
    let resumed=0;wake.setResumeHandler(async()=>{resumed++;});
    const result=await wake.ingest({triggerId:trigger.id,ownerSessionId:"a",eventKey:"failed-once",type:"WEBHOOK",payloadJson:{}});
    expect(result.woke).toBe(false);
    expect(result.reason).toBe("failed-needs-review");
    expect(resumed).toBe(0);
    expect(events.getEvent(first.id)?.status).toBe("FAILED");
  });

  it("TIME scheduler wakes the task once and advances the occurrence",async()=>{
    const {t,events,db}=setup();
    events.addTrigger({ownerSessionId:"a",livingTaskId:t.id,type:"TIME",configJson:{intervalMinutes:60},nextDueAt:"2026-01-01T09:00:00.000Z"});
    const wake=new WakeEngine(db,events);
    let resumed=0;wake.setResumeHandler(async()=>{resumed++;});
    const scheduler=new TriggerScheduler(events,wake);
    expect(await scheduler.tick(new Date("2026-01-01T09:00:00Z"))).toBe(1);
    expect(resumed).toBe(1);
    expect(events.listEvents("a",t.id)[0]?.status).toBe("PROCESSED");
    expect(await scheduler.tick(new Date("2026-01-01T09:00:00Z"))).toBe(0);
    expect(resumed).toBe(1);
  });
});
