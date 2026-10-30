import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../lib/db/migrate';
import type { WorkflowAnalysis, WorkflowTask } from '../../lib/domain/types';
import { GoalContracts } from '../../lib/tasks/goal-contract';
import { LivingTaskEngine } from '../../lib/tasks/engine';
import { TaskPlanner } from '../../lib/tasks/planner';
import { WorkflowEngine } from '../../lib/workflow/engine';

const databases: Database.Database[] = [];
const temporaryRoots: string[] = [];
afterEach(() => {
  databases.splice(0).forEach(db => db.close());
  temporaryRoots.splice(0).forEach(root => {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe temporary cleanup');
    rmSync(root, { recursive: true, force: true });
  });
});
const actor = { id: 'owner', sessionId: 'goal-evidence-owner', role: 'USER' as const };
const risk = { moneyMovement: 0, externalTransmission: 0, sensitiveData: 0, legalEffect: 0, organizationalAuthority: 0, userRepresentation: 0, destructiveMutation: 0, reversibility: 5 } as const;
const lookup: WorkflowTask = { id: 'lookup', title: 'Check current participants', kind: 'DATA_LOOKUP', actionType: 'employee.lookup', dependsOn: [], condition: null, expectedOutput: null, risk };
function analysis(tasks: WorkflowTask[] = [lookup]): WorkflowAnalysis {
  return { summary: 'Refresh the verified evidence', facts: [], tasks, edges: [], warnings: [], provider: { provider: 'demo', model: 'fixture', mode: 'demo', realModelCalled: false } };
}
function setup(plan: WorkflowAnalysis = analysis(), dataDir = 'unused') {
  const db = new Database(':memory:'); databases.push(db); runMigrations(db);
  const workflows = new WorkflowEngine(db, dataDir);
  const planner = new TaskPlanner(db, workflows, undefined, () => async () => plan);
  const tasks = new LivingTaskEngine(db, workflows, planner);
  const task = tasks.createGoal({ title: 'Current evidence', goal: 'Verify the current work before completion' }, actor);
  return { db, workflows, tasks, task, contracts: new GoalContracts(db) };
}

describe('goal requirements belong to the work they verify', () => {
  it('does not reuse an earlier successful lookup while its replacement is still unexecuted', async () => {
    const { tasks, task, contracts } = setup();
    await tasks.executeCurrent(task.id, actor);
    const previous = contracts.view(task.id, actor.sessionId)!;
    expect(previous.requirements.find(item => item.kind === 'STEP')?.passed).toBe(true);

    await tasks.planNext(task.id, actor);
    const next = contracts.view(task.id, actor.sessionId)!;
    expect(next.requirements.find(item => item.kind === 'STEP')?.passed).toBe(false);
    expect(next.version).toBeGreaterThan(previous.version);

    await tasks.executeCurrent(task.id, actor);
    const finished = contracts.view(task.id, actor.sessionId)!;
    expect(finished.requirements.find(item => item.kind === 'STEP')?.passed).toBe(true);
    await expect(contracts.complete(task.id, actor, previous.version, previous.requirements.map(item => item.id), 'unused')).rejects.toThrow();
    await expect(contracts.complete(task.id, actor, finished.version, finished.requirements.map(item => item.id), 'unused')).resolves.toMatchObject({ status: 'COMPLETED' });
  });

  it('requires every occurrence of a repeated action, including the one still awaiting confirmation', async () => {
    const second = { ...lookup, id: 'confirm-lookup', title: 'Check the second participant set', dependsOn: ['lookup'], suggestedPolicy: 'CONFIRM' as const };
    const { tasks, task, contracts, workflows } = setup(analysis([lookup, second]));
    const waiting = await tasks.executeCurrent(task.id, actor);
    expect(waiting.status).toBe('WAITING_APPROVAL');
    expect(contracts.view(task.id, actor.sessionId)!.requirements.find(item => item.kind === 'STEP')?.passed).toBe(false);

    const approval = workflows.getSnapshot(waiting.currentWorkflowId!).approvals[0];
    await workflows.resolveApproval(approval.id, 'APPROVED', approval.version, actor);
    expect(contracts.view(task.id, actor.sessionId)!.requirements.find(item => item.kind === 'STEP')?.passed).toBe(true);
  });

  it('resolves a legacy requirement against the latest planned occurrence even when that occurrence failed', async () => {
    const { db, tasks, task, contracts } = setup();
    await tasks.executeCurrent(task.id, actor);
    const replacement = await tasks.planNext(task.id, actor);
    db.prepare("UPDATE goal_requirements SET spec_json=? WHERE living_task_id=? AND kind='STEP'")
      .run(JSON.stringify({ action: 'employee.lookup' }), task.id);
    db.prepare("UPDATE workflows SET status='FAILED' WHERE id=?").run(replacement.workflowId);
    db.prepare("UPDATE workflow_nodes SET status='FAILED' WHERE workflow_id=?").run(replacement.workflowId);
    expect(contracts.view(task.id, actor.sessionId)!.requirements.find(item => item.kind === 'STEP')?.passed).toBe(false);
  });

  it('keeps a repeated artifact requirement unmet if either generated file is no longer committed', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'actflow-goal-evidence-')); temporaryRoots.push(root);
    const roster: WorkflowTask = { ...lookup, id: 'first-roster', title: 'First roster', kind: 'DOCUMENT_GENERATION', actionType: 'artifact.xlsx.participants', dependsOn: ['lookup'] };
    const { db, tasks, task, contracts } = setup(analysis([lookup, roster, { ...roster, id: 'second-roster', title: 'Second roster', dependsOn: ['first-roster'] }]), root);
    const done = await tasks.executeCurrent(task.id, actor);
    expect(done.status).toBe('WAITING_EVENT');
    expect(contracts.view(task.id, actor.sessionId)!.requirements.find(item => item.kind === 'ARTIFACT')?.passed).toBe(true);
    db.prepare("UPDATE artifacts SET state='DELETED' WHERE workflow_id=? AND node_id='second-roster'").run(done.currentWorkflowId);
    const view = contracts.view(task.id, actor.sessionId)!;
    expect(view.requirements.find(item => item.kind === 'ARTIFACT')?.passed).toBe(false);
    expect(view.readyToComplete).toBe(false);
  });

  it('rejects evidence bindings from another task without changing the contract', async () => {
    const { tasks, task, contracts } = setup();
    const other = tasks.createGoal({ title: 'Other task', goal: 'A separate goal' }, actor);
    const foreign = await tasks.planNext(other.id, actor);
    const before = contracts.view(task.id, actor.sessionId);
    expect(() => contracts.registerPlan(task.id, actor.sessionId, analysis(), '', foreign.workflowId)).toThrow();
    expect(contracts.view(task.id, actor.sessionId)).toEqual(before);
  });

  it('does not let an earlier sent reply satisfy a new proposal awaiting its durable handoff', async () => {
    const done: WorkflowTask = { ...lookup, id: 'done', title: 'Review incoming mail', kind: 'COMPLETION', actionType: 'workflow.complete' };
    const plan = analysis([done]);
    plan.emailReply = { subject: 'Re: Current question', body: 'Verified answer', attachGeneratedArtifacts: false };
    const { db, tasks, task, contracts } = setup(plan);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO mail_messages(id,owner_session_id,living_task_id,message_id,direction,from_address,to_address,subject,body,created_at)
      VALUES ('incoming',?,?,'incoming-message','INBOUND','partner@example.com','owner@example.com','Current question','Please review',?)`).run(actor.sessionId, task.id, now);
    const first = await tasks.executeCurrent(task.id, actor);
    db.prepare(`INSERT INTO mail_outbox(id,owner_session_id,living_task_id,workflow_id,inbound_message_id,draft_hash,draft_json,requires_approval,status,result_json,created_at,updated_at)
      VALUES ('previous-reply',?,?,?,'incoming-message','previous-hash','{}',0,'SENT',?,?,?)`).run(actor.sessionId, task.id, first.currentWorkflowId, JSON.stringify({ ok: true, sent: true, messageId: 'verified-remote-receipt', externalEffect: 'ACTUAL', remoteVerified: true }), now, now);
    db.prepare("UPDATE task_episode_context SET reply_status='DISPATCHED' WHERE workflow_id=?").run(first.currentWorkflowId);
    expect(contracts.view(task.id, actor.sessionId)!.requirements.find(item => item.kind === 'MAIL')?.passed).toBe(true);

    for (const receipt of ['invalid-json', 'null', JSON.stringify({ externalEffect: 'ACTUAL', remoteVerified: true }), JSON.stringify({ ok: true, sent: true, messageId: 'simulated', externalEffect: 'SIMULATED', remoteVerified: true })]) {
      db.prepare("UPDATE mail_outbox SET result_json=? WHERE id='previous-reply'").run(receipt);
      expect(contracts.view(task.id, actor.sessionId)!.requirements.find(item => item.kind === 'MAIL')?.passed).toBe(false);
    }
    db.prepare("UPDATE mail_outbox SET result_json=? WHERE id='previous-reply'").run(JSON.stringify({ ok: true, sent: true, messageId: 'verified-remote-receipt', externalEffect: 'ACTUAL', remoteVerified: true }));

    await tasks.planNext(task.id, actor);
    await tasks.executeCurrent(task.id, actor);
    const pending = contracts.view(task.id, actor.sessionId)!;
    expect(pending.requirements.find(item => item.kind === 'MAIL')?.passed).toBe(false);
    expect(pending.readyToComplete).toBe(false);
    await expect(contracts.complete(task.id, actor, pending.version, pending.requirements.map(item => item.id), 'unused')).rejects.toThrow();
  });
});
