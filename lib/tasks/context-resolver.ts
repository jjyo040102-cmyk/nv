import type Database from 'better-sqlite3';
import { resolveDataScope } from '../security/data-scope';
import { MemoryRepository } from './memory-repository';
export type ContextItem = { sourceType: string; sourceId: string; scope: string; observedAt: string; confidence: number; summary: string; score: number };
export type ResolvedContext = { items: ContextItem[]; query: string; projectId?: string; livingTaskId?: string };
function tokens(value: string): Set<string> { return new Set(value.toLocaleLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(Boolean)); }
function relevance(query: string, text: string): number {
  const q = tokens(query), t = tokens(text); let hit = 0;
  for (const x of q) if (t.has(x)) hit++;
  return q.size ? hit / q.size : 0;
}
export class ContextResolver {
  constructor(private readonly db: Database.Database) {}
  resolve(input: { ownerSessionId: string; livingTaskId?: string; projectId?: string; query: string; maxItems?: number; includeMemory?: boolean }): ResolvedContext {
    let scope: ReturnType<typeof resolveDataScope>;
    try { scope = resolveDataScope(this.db, input); }
    catch { return { items: [], query: input.query, livingTaskId: input.livingTaskId, projectId: input.projectId }; }
    const items: ContextItem[] = [];
    if (input.includeMemory !== false) {
      for (const m of new MemoryRepository(this.db).listForPlanning({ ...input, projectId: scope.projectId ?? undefined, limit: 100 })) {
        items.push({ sourceType: m.sourceType, sourceId: m.sourceId, scope: m.scope, observedAt: m.updatedAt, confidence: m.confidence, summary: m.summary, score: 0 });
      }
    }
    // A scoped task without a project is not a workspace-wide request.
    const clause = scope.projectId ? 't.project_id=?' : input.livingTaskId ? 't.id=?' : '1=1';
    const values: string[] = [input.ownerSessionId];
    if (scope.projectId) values.push(scope.projectId); else if (input.livingTaskId) values.push(input.livingTaskId);
    const taskRows = this.db.prepare(`SELECT t.id,t.title,t.goal,t.status,t.updated_at,p.name AS project_name
      FROM living_tasks t LEFT JOIN projects p ON p.id=t.project_id AND p.owner_session_id=t.owner_session_id
      WHERE t.owner_session_id=? AND ${clause}`).all(...values) as Array<{ id: string; title: string; goal: string; status: string; updated_at: string; project_name: string | null }>;
    for (const t of taskRows) items.push({ sourceType: 'task', sourceId: t.id, scope: 'TASK', observedAt: t.updated_at, confidence: 1, summary: `${t.project_name ? `[${t.project_name}] ` : ''}${t.title}: ${t.goal} [${t.status}]`, score: 0 });
    let evidenceSql = 'SELECT * FROM task_evidence WHERE owner_session_id=?'; const evidenceArgs: string[] = [input.ownerSessionId];
    if (input.livingTaskId) { evidenceSql += ' AND living_task_id=?'; evidenceArgs.push(input.livingTaskId); }
    else if (scope.projectId) { evidenceSql += ' AND project_id=?'; evidenceArgs.push(scope.projectId); }
    for (const e of this.db.prepare(evidenceSql).all(...evidenceArgs) as Array<{ source_type: string; source_id: string; observed_at: string; confidence: number; summary: string }>) {
      items.push({ sourceType: e.source_type, sourceId: e.source_id, scope: 'EVIDENCE', observedAt: e.observed_at, confidence: e.confidence, summary: e.summary, score: 0 });
    }
    // Authorized concrete evidence, not model-invented progress or provider-native history.
    const workflows = this.db.prepare(`SELECT w.id,w.status,w.analysis_json,w.updated_at FROM workflows w
      JOIN living_tasks t ON t.id=w.living_task_id AND t.owner_session_id=w.owner_session_id
      WHERE t.owner_session_id=? AND ${clause} ORDER BY w.updated_at DESC LIMIT 30`).all(...values) as Array<{ id: string; status: string; analysis_json: string | null; updated_at: string }>;
    for (const w of workflows) {
      let summary = ''; try { summary = JSON.parse(w.analysis_json ?? '{}').summary ?? ''; } catch { /* Corrupt evidence is not interpreted as success. */ }
      items.push({ sourceType: 'workflow', sourceId: w.id, scope: 'EVIDENCE', observedAt: w.updated_at, confidence: 1, summary: `[${w.status}] ${String(summary).slice(0, 3000)}`, score: 0 });
    }
    const artifacts = this.db.prepare(`SELECT a.id,a.display_name,a.state,a.verification_status,a.updated_at FROM artifacts a
      JOIN workflows w ON w.id=a.workflow_id JOIN living_tasks t ON t.id=w.living_task_id AND t.owner_session_id=w.owner_session_id
      WHERE t.owner_session_id=? AND ${clause} ORDER BY a.updated_at DESC LIMIT 30`).all(...values) as Array<{ id: string; display_name: string; state: string; verification_status: string; updated_at: string }>;
    for (const a of artifacts) items.push({ sourceType: 'artifact', sourceId: a.id, scope: 'EVIDENCE', observedAt: a.updated_at, confidence: 1, summary: `${a.display_name}: ${a.state}, verification=${a.verification_status}`, score: 0 });
    const emails = this.db.prepare(`SELECT m.message_id,m.from_address,m.subject,m.body,m.created_at FROM mail_messages m
      JOIN living_tasks t ON t.id=m.living_task_id AND t.owner_session_id=m.owner_session_id
      WHERE t.owner_session_id=? AND ${clause} AND m.direction='INBOUND' ORDER BY m.created_at DESC LIMIT 10`).all(...values) as Array<{ message_id: string; from_address: string; subject: string; body: string; created_at: string }>;
    for (const m of emails) items.push({ sourceType: 'email', sourceId: m.message_id, scope: 'UNTRUSTED_EVIDENCE', observedAt: m.created_at, confidence: 1, summary: `Untrusted email from ${m.from_address}; subject=${m.subject}\n${m.body.slice(0, 6000)}`, score: 0 });
    const scored = items.map(x => ({ ...x, score: relevance(input.query, x.summary) + x.confidence * 0.1 }))
      .sort((a, b) => b.score - a.score || Date.parse(b.observedAt) - Date.parse(a.observedAt));
    return { items: scored.slice(0, Math.max(1, Math.min(input.maxItems ?? 50, 100))), query: input.query, projectId: scope.projectId ?? undefined, livingTaskId: input.livingTaskId };
  }
}
