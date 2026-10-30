import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../lib/db/migrate";
import { LivingTaskEngine } from "../../lib/tasks/engine";
import { TaskPlanner } from "../../lib/tasks/planner";
import { WorkflowEngine } from "../../lib/workflow/engine";
import { GoalContracts, factHasSource } from "../../lib/tasks/goal-contract";
import type { WorkflowAnalysis } from "../../lib/domain/types";
const dbs:Database.Database[]=[];
afterEach(()=>dbs.splice(0).forEach(db=>db.close()));
const actor={id:"owner",sessionId:"workspace",role:"USER" as const};
const plan:WorkflowAnalysis={summary:"Document reviewed",facts:[],tasks:[{id:"done",title:"Review",kind:"COMPLETION",actionType:"workflow.complete",dependsOn:[],condition:null,expectedOutput:null,risk:{moneyMovement:0,externalTransmission:0,sensitiveData:0,legalEffect:0,organizationalAuthority:0,userRepresentation:0,destructiveMutation:0,reversibility:5}}],edges:[],warnings:[],provider:{provider:"demo",model:"fixture",mode:"demo",realModelCalled:false}};
function setup(){const db=new Database(":memory:");dbs.push(db);runMigrations(db);const workflows=new WorkflowEngine(db,"data/runtime/test-unused"),planner=new TaskPlanner(db,workflows,undefined,()=>async()=>plan),tasks=new LivingTaskEngine(db,workflows,planner);return {db,tasks,contracts:new GoalContracts(db)};}
describe("goal completion has a separate evidence boundary",()=>{
  it('replaces corrected fact evidence without changing the original goal or keeping a stale false requirement',async()=>{
    const {tasks,contracts}=setup(),task=tasks.createGoal({title:'T',goal:'Original goal'},actor);await tasks.executeCurrent(task.id,actor);
    const goalHash=contracts.view(task.id,actor.sessionId)!.goalHash;
    contracts.registerPlan(task.id,actor.sessionId,{...plan,facts:[{key:'expenseKrw',value:'999',confidence:1}]},'Cost 100');
    const before=contracts.view(task.id,actor.sessionId)!;
    contracts.registerPlan(task.id,actor.sessionId,{...plan,facts:[{key:'expenseKrw',value:'100',confidence:1,evidence:{source:'notice',quoteOrLocator:'Cost 100'}}]},'Cost 100');
    const after=contracts.view(task.id,actor.sessionId)!;
    expect(after.version).toBeGreaterThan(before.version);expect(after.goalHash).toBe(goalHash);
    expect(after.requirements.filter(r=>r.kind==='FACT')).toMatchObject([{label:'비용: 100',passed:true}]);
  });
  it("does not turn a model COMPLETE claim into goal completion and requires the current owner's confirmation",async()=>{
    const {tasks,contracts}=setup(),task=tasks.createGoal({title:"Review",goal:"Check the document"},actor);
    await tasks.executeCurrent(task.id,actor);expect(tasks.get(task.id,actor)?.status).toBe("WAITING_EVENT");
    const view=contracts.view(task.id,actor.sessionId)!;
    await expect(contracts.complete(task.id,actor,view.version,[],"unused")).rejects.toThrow(/완료 조건/);
    await expect(contracts.complete(task.id,{...actor,sessionId:"other"},view.version,view.requirements.map(r=>r.id),"unused")).rejects.toThrow();
    const done=await contracts.complete(task.id,actor,view.version,view.requirements.map(r=>r.id),"unused");expect(done.status).toBe("COMPLETED");
  });
  it("rejects stale confirmation after new evidence requirements were added",async()=>{
    const {tasks,contracts}=setup(),task=tasks.createGoal({title:"T",goal:"G"},actor);await tasks.executeCurrent(task.id,actor);
    const previous=contracts.view(task.id,actor.sessionId)!;contracts.registerPlan(task.id,actor.sessionId,{...plan,facts:[{key:"expenseKrw",value:"999",confidence:1} ]},"Cost 100");
    await expect(contracts.complete(task.id,actor,previous.version,previous.requirements.map(r=>r.id),"unused")).rejects.toThrow();
    const next=contracts.view(task.id,actor.sessionId)!;expect(next.requirements.find(r=>r.kind==="FACT")).toMatchObject({passed:false,canConfirm:true});
  });
  it("compares quoted source text and amount without treating unsupported claims as evidence",()=>{
    expect(factHasSource("150000","총비용 150,000원","안내: 총비용 150,000원입니다.","expenseKrw")).toBe(true);
    expect(factHasSource("999999","총비용 150,000원","안내: 총비용 150,000원입니다.","expenseKrw")).toBe(false);
    expect(factHasSource("150000","총비용 150,000원","모든 비용은 0원","expenseKrw")).toBe(false);
    expect(factHasSource("150000",undefined,"150000","expenseKrw")).toBe(false);
  });
});
