import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { resetRuntimeForTests } from "../../lib/api/runtime";
import { POST as createTask, GET as listTasks } from "../../app/api/tasks/route";
import { GET as readTask } from "../../app/api/tasks/[id]/route";
import { POST as addTrigger, GET as listTriggers } from "../../app/api/tasks/[id]/triggers/route";
import { POST as manualWake } from "../../app/api/tasks/[id]/wake/route";

const roots:string[]=[];
afterEach(()=>{resetRuntimeForTests();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});delete process.env.ACTFLOW_DB_PATH;delete process.env.ACTFLOW_DATA_DIR;});
function env(){const root=mkdtempSync(resolve(tmpdir(),"actflow-task-api-"));roots.push(root);process.env.ACTFLOW_DATA_DIR=root;process.env.ACTFLOW_DB_PATH=resolve(root,"db.sqlite");process.env.ACTFLOW_DEMO_AUTH="true";}
function req(url:string,method="GET",body?:unknown){return new Request(`http://localhost${url}`,{method,headers:body?{"content-type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined});}

it("creates, lists, reads, triggers and manually wakes a persistent task",async()=>{env();const created=await createTask(req("/api/tasks","POST",{title:"Follow up",goal:"Continue the work",backgroundWatchEnabled:true}));expect(created.status).toBe(201);const task=(await created.json()).task;const listed=await listTasks(req("/api/tasks"));expect((await listed.json()).tasks.some((x:any)=>x.id===task.id)).toBe(true);const read=await readTask(req(`/api/tasks/${task.id}`),{params:Promise.resolve({id:task.id})});expect((await read.json()).task.id).toBe(task.id);const tr=await addTrigger(req(`/api/tasks/${task.id}/triggers`,"POST",{type:"MANUAL",config:{}}),{params:Promise.resolve({id:task.id})});expect(tr.status).toBe(201);const tl=await listTriggers(req(`/api/tasks/${task.id}/triggers`),{params:Promise.resolve({id:task.id})});expect((await tl.json()).triggers.length).toBeGreaterThan(0);const wake=await manualWake(req(`/api/tasks/${task.id}/wake`,"POST",{}),{params:Promise.resolve({id:task.id})});expect(wake.status).toBe(400);expect((await wake.json()).error.message).toContain("Nebius");});
