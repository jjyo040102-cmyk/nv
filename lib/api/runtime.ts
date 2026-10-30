import type Database from "better-sqlite3";
import { readConfig, type AppConfig } from "../config";
import { openDatabase } from "../db";
import { runMigrations } from "../db/migrate";
import { WorkflowRepository } from "../db/repository";
import { CredentialStore } from "../providers/credentials";
import { AnalysisCache } from "../providers/provider";
import { WorkflowEngine } from "../workflow/engine";
import { testAwareUnlink } from "../testing/faults";
import { ProjectRepository } from "../tasks/project-repository";
import { LivingTaskRepository } from "../tasks/repository";
import { MemoryRepository } from "../tasks/memory-repository";
import { AgentSessionRepository } from "../tasks/session-repository";
import { TaskPlanner } from "../tasks/planner";
import { LivingTaskEngine } from "../tasks/engine";
import { ProjectStateService } from "../tasks/project-state";
import { EventRepository } from "../events/repository";
import { WakeEngine } from "../events/wake-engine";
import { TriggerScheduler } from "../events/scheduler";
import { DemoMailTransport } from "../email/demo-transport";
import { EmailService } from "../email/service";
import { VerifiedContactRepository } from "../email/verified-contacts";
import { setMailTransport } from "../email/transport-registry";
import type { MailTransport } from "../email/types";
import { GmailConnection } from "../email/gmail-connection";
import { GmailClient } from "../email/gmail-client";
import { GmailSync } from "../email/gmail-sync";

export type ApiRuntime = { config: AppConfig; db: Database.Database; repo: WorkflowRepository; engine: WorkflowEngine; credentials: CredentialStore; cache: AnalysisCache; projects:ProjectRepository; taskRepo:LivingTaskRepository; memory:MemoryRepository; agentSessions:AgentSessionRepository; planner:TaskPlanner; tasks:LivingTaskEngine; projectState:ProjectStateService; events:EventRepository; wake:WakeEngine; scheduler:TriggerScheduler; email:EmailService; verifiedContacts:VerifiedContactRepository; mailTransport:MailTransport; gmail:GmailConnection; gmailClient:GmailClient; gmailSync:GmailSync };

type MaintenanceTimer = ReturnType<typeof setInterval>;
const globalRuntime = globalThis as typeof globalThis & {
  __actflowRuntime?: ApiRuntime;
  __actflowMaintenanceTimer?: MaintenanceTimer;
  __actflowMaintenanceBusy?: boolean;
};

function stopMaintenance(): void {
  if (globalRuntime.__actflowMaintenanceTimer) clearInterval(globalRuntime.__actflowMaintenanceTimer);
  delete globalRuntime.__actflowMaintenanceTimer;
  delete globalRuntime.__actflowMaintenanceBusy;
}

function startMaintenance(runtime: ApiRuntime): void {
  if (process.env.NODE_ENV === "test" || process.env.ACTFLOW_WORKER_ENABLED === "false" || globalRuntime.__actflowMaintenanceTimer) return;
  const run = async () => {
    if (globalRuntime.__actflowMaintenanceBusy || globalRuntime.__actflowRuntime !== runtime) return;
    globalRuntime.__actflowMaintenanceBusy = true;
    try {
      await runtime.engine.recoverInterruptedExecutions();
      await runtime.email.recoverPendingReplies();
      await runtime.wake.recoverInterruptedEvents();
      await runtime.wake.processPendingEvents();
      await runtime.scheduler.tick();
      await runtime.gmailSync.tick();
      runtime.db.prepare("INSERT INTO worker_health(id,last_tick_at,last_error) VALUES (1,?,NULL) ON CONFLICT(id) DO UPDATE SET last_tick_at=excluded.last_tick_at,last_error=NULL").run(new Date().toISOString());
    } catch {
      runtime.db.prepare("INSERT INTO worker_health(id,last_tick_at,last_error) VALUES (1,?,'MAINTENANCE_FAILED') ON CONFLICT(id) DO UPDATE SET last_error='MAINTENANCE_FAILED'").run(new Date().toISOString());
    } finally {
      globalRuntime.__actflowMaintenanceBusy = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), 30_000);
  timer.unref?.();
  globalRuntime.__actflowMaintenanceTimer = timer;
}

export function getRuntime(): ApiRuntime {
  const config = readConfig(process.env);
  const current = globalRuntime.__actflowRuntime;
  if (current && current.config.dbPath === config.dbPath && current.config.dataDir === config.dataDir && current.config.masterKey === config.masterKey) return current;
  if (current) { stopMaintenance(); current.db.close(); }
  const db = openDatabase(config); runMigrations(db);
  const repo=new WorkflowRepository(db);
  const engine=new WorkflowEngine(db,config.dataDir,{unlink:testAwareUnlink});
  const credentials=new CredentialStore(db,config.masterKey);
  const cache=new AnalysisCache();
  const projects=new ProjectRepository(db);
  const taskRepo=new LivingTaskRepository(db);
  const memory=new MemoryRepository(db);
  const agentSessions=new AgentSessionRepository(db);
  const planner=new TaskPlanner(db,engine,credentials);
  const tasks=new LivingTaskEngine(db,engine,planner);
  const projectState=new ProjectStateService(db);
  const events=new EventRepository(db);
  const wake=new WakeEngine(db,events);
  const scheduler=new TriggerScheduler(events,wake);
  const gmail=new GmailConnection(db,config.masterKey), gmailClient=new GmailClient(gmail);
  const mailTransport:MailTransport=process.env.ACTFLOW_TEST_MODE==='true'&&process.env.NODE_ENV!=='production'?new DemoMailTransport():gmailClient;
  setMailTransport(mailTransport,db);
  const verifiedContacts=new VerifiedContactRepository(db);
  const email=new EmailService(db,tasks,events,wake,engine,mailTransport,config.dataDir);
  const gmailSync=new GmailSync(db,gmailClient,email);
  wake.setResumeHandler(async(taskId,ownerSessionId,wakeEventId)=>{
    await tasks.handleWake(taskId,{id:"actflow-auto",sessionId:ownerSessionId,role:"USER"},wakeEventId);
  });
  const runtime={config,db,repo,engine,credentials,cache,projects,taskRepo,memory,agentSessions,planner,tasks,projectState,events,wake,scheduler,email,verifiedContacts,mailTransport,gmail,gmailClient,gmailSync};
  globalRuntime.__actflowRuntime=runtime;
  startMaintenance(runtime);
  return runtime;
}

export function resetRuntimeForTests(): void {
  stopMaintenance();
  globalRuntime.__actflowRuntime?.db.close();
  delete globalRuntime.__actflowRuntime;
}
