import type Database from 'better-sqlite3';
export type StateEvidence = { sourceType: string; sourceId: string; category: string; summary: string; status: string | null; observedAt: string; confidence: number };
export type ProjectStateSummary = { completed: StateEvidence[]; inProgress: StateEvidence[]; blocked: StateEvidence[]; unknown: StateEvidence[]; conflicts: Array<{ category: string; evidence: StateEvidence[] }>; progressPercent: number | null };
type StoredEvidence = { source_type: string; source_id: string; category: string; summary: string; status: string | null; observed_at: string; confidence: number; milestone_weight: number | null; milestone_progress: number | null };
const empty = (): ProjectStateSummary => ({ completed: [], inProgress: [], blocked: [], unknown: [], conflicts: [], progressPercent: null });

export class ProjectStateService {
  constructor(private readonly db: Database.Database) {}
  summarize(input: { ownerSessionId: string; projectId: string }): ProjectStateSummary {
    const args = [input.ownerSessionId, input.projectId];
    if (!this.db.prepare('SELECT 1 FROM projects WHERE owner_session_id=? AND id=?').get(...args)) return empty();
    const rows = this.db.prepare('SELECT * FROM task_evidence WHERE owner_session_id=? AND project_id=? ORDER BY observed_at DESC').all(...args) as StoredEvidence[];
    const all: StateEvidence[] = rows.map(row => ({ sourceType: row.source_type, sourceId: row.source_id, category: row.category, summary: row.summary, status: row.status, observedAt: row.observed_at, confidence: row.confidence }));
    const tasks = this.db.prepare('SELECT id,title,status,updated_at FROM living_tasks WHERE owner_session_id=? AND project_id=?').all(...args) as Array<{ id: string; title: string; status: string; updated_at: string }>;
    const concreteCategories = new Set<string>();
    for (const task of tasks) {
      concreteCategories.add(`task:${task.id}`);
      all.push({ sourceType: 'task', sourceId: task.id, category: `task:${task.id}`, summary: task.title, status: task.status, observedAt: task.updated_at, confidence: 1 });
    }
    const workflows = this.db.prepare(`SELECT w.id,w.source_name,w.status,w.updated_at FROM workflows w
      JOIN living_tasks t ON t.id=w.living_task_id AND t.owner_session_id=w.owner_session_id
      WHERE t.owner_session_id=? AND t.project_id=?`).all(...args) as Array<{ id: string; source_name: string; status: string; updated_at: string }>;
    for (const workflow of workflows) {
      concreteCategories.add(`workflow:${workflow.id}`);
      all.push({ sourceType: 'workflow', sourceId: workflow.id, category: `workflow:${workflow.id}`, summary: workflow.source_name, status: workflow.status, observedAt: workflow.updated_at, confidence: 1 });
    }
    const artifacts = this.db.prepare(`SELECT a.id,a.display_name,a.state,a.verification_status,a.updated_at FROM artifacts a
      JOIN workflows w ON w.id=a.workflow_id JOIN living_tasks t ON t.id=w.living_task_id AND t.owner_session_id=w.owner_session_id
      WHERE t.owner_session_id=? AND t.project_id=?`).all(...args) as Array<{ id: string; display_name: string; state: string; verification_status: string; updated_at: string }>;
    for (const artifact of artifacts) {
      concreteCategories.add(`artifact:${artifact.id}`);
      all.push({ sourceType: 'artifact', sourceId: artifact.id, category: `artifact:${artifact.id}`, summary: artifact.display_name,
        status: artifact.state === 'COMMITTED' && artifact.verification_status === 'VERIFIED' ? 'VERIFIED' : artifact.state === 'DELETE_FAILED' || artifact.verification_status === 'FAILED' ? 'FAILED' : null,
        observedAt: artifact.updated_at, confidence: 1 });
    }
    const groups = new Map<string, StateEvidence[]>();
    for (const item of all) { const group = groups.get(item.category) ?? []; group.push(item); groups.set(item.category, group); }
    const result = empty(), accepted: StateEvidence[] = [];
    for (const [category, group] of groups) {
      // A claimed evidence timestamp cannot replace the live state of a task/artifact/workflow.
      if (concreteCategories.has(category)) {
        const concrete = group[group.length - 1];
        accepted.push(concrete);
        const contrary = group.slice(0, -1).filter(item => item.status !== concrete.status);
        if (contrary.length) result.conflicts.push({ category, evidence: [concrete, ...contrary] });
        continue;
      }
      group.sort((a, b) => b.observedAt.localeCompare(a.observedAt) || b.confidence - a.confidence);
      const latest = group[0];
      const peers = group.filter(item => item.observedAt === latest.observedAt && Math.abs(item.confidence - latest.confidence) < 1e-9);
      if (new Set(peers.map(item => item.status)).size > 1) result.conflicts.push({ category, evidence: peers });
      else accepted.push(latest);
    }
    for (const item of accepted) {
      if (item.status && ['COMPLETED','VERIFIED','DONE'].includes(item.status)) result.completed.push(item);
      else if (item.status && ['RUNNING','IN_PROGRESS','READY','ANALYZED'].includes(item.status)) result.inProgress.push(item);
      else if (item.status && ['BLOCKED','FAILED','WAITING_APPROVAL'].includes(item.status)) result.blocked.push(item);
      else result.unknown.push(item);
    }
    const acceptedKeys = new Set(accepted.map(item => JSON.stringify([item.category, item.sourceId, item.observedAt])));
    const milestones = rows.filter(row => !concreteCategories.has(row.category) && acceptedKeys.has(JSON.stringify([row.category,row.source_id,row.observed_at]))
      && typeof row.milestone_weight === 'number' && Number.isFinite(row.milestone_weight) && row.milestone_weight > 0
      && typeof row.milestone_progress === 'number' && Number.isFinite(row.milestone_progress));
    if (milestones.length) {
      const total = milestones.reduce((sum, row) => sum + row.milestone_weight!, 0);
      const weighted = milestones.reduce((sum, row) => sum + row.milestone_weight! * Math.max(0, Math.min(1, row.milestone_progress!)), 0);
      result.progressPercent = Math.round(weighted / total * 100);
    }
    return result;
  }
}
