'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, CheckCircle2, CircleAlert, Clock3, Download, FileCheck2, FileText, FileUp, ListChecks, LoaderCircle, Plus, Search, Settings2, ShieldCheck, Sparkles, X } from 'lucide-react';
import type { Artifact, Participant, Task, TaskDetails, TaskStatus } from '@/lib/task-types';

type TaskSummary = Pick<Task, 'id' | 'title' | 'goal' | 'status' | 'version' | 'is_sample' | 'created_at' | 'updated_at' | 'completed_at'>;
type Filter = 'all' | 'attention' | 'active' | 'completed';
type Form = { goal: string; sourceName: string; sourceText: string; participantLines: string; recipient: string; responseText: string; expenseKrw: string; isSample: boolean };
type ModelSettings = { connected: boolean; model: string; updatedAt: string | null };
const emptyForm: Form = { goal: '', sourceName: '', sourceText: '', participantLines: '', recipient: '', responseText: '', expenseKrw: '0', isSample: false };
const sample: Form = {
  goal: 'Prepare a training list and response. Review expenses before sending.',
  sourceName: 'sample-training-notice.txt',
  sourceText: 'Training Operations\nPlease prepare a list of employees attending the AI training and a response for review.\nEstimated travel expense: KRW 180,000. Expenses of KRW 100,000 or more require approval.',
  participantLines: 'E001, Kim Min-ji, Human Resources, Assistant Manager\nE002, Lee Jun-ho, Development, Manager',
  recipient: 'Training Operations', responseText: 'Please find the training participant list prepared for your review.', expenseKrw: '180000', isSample: true,
};
const labels: Record<TaskStatus, string> = { DRAFT: 'Ready to prepare', WAITING_APPROVAL: 'Approval needed', RUNNING: 'Preparing', READY: 'Ready for review', REJECTED: 'Rejected', FAILED: 'Needs attention', COMPLETED: 'Completed' };
const time = (value: string) => new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, cache: 'no-store', headers: { ...(options?.body ? { 'Content-Type': 'application/json' } : {}), ...options?.headers } });
  const result = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result as T;
}
function parseParticipants(input: string): Participant[] {
  return input.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    const values: string[] = []; let current = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') { if (quoted && line[i + 1] === '"') { current += '"'; i++; } else quoted = !quoted; }
      else if (char === ',' && !quoted) { values.push(current.trim()); current = ''; }
      else current += char;
    }
    values.push(current.trim());
    if (quoted || values.length !== 4 || !values[0] || !values[1]) throw new Error(`Check participant row ${index + 1}: use ID, name, department, role.`);
    return { id: values[0], name: values[1], department: values[2], role: values[3] };
  });
}
function Badge({ status }: { status: TaskStatus }) { return <span className={`status status-${status.toLowerCase()}`}><i />{labels[status]}</span>; }

export function Workspace({ displayName }: { displayName: string }) {
  const [tasks, setTasks] = useState<TaskSummary[]>([]), [filter, setFilter] = useState<Filter>('all'), [query, setQuery] = useState('');
  const [view, setView] = useState<'tasks' | 'compose' | 'detail' | 'settings'>('tasks'), [form, setForm] = useState<Form>(emptyForm);
  const [detail, setDetail] = useState<TaskDetails | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [reviewed, setReviewed] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [settings, setSettings] = useState<ModelSettings | null>(null), [model, setModel] = useState('nvidia/nemotron-3-super-120b-a12b'), [apiKey, setApiKey] = useState(''), [message, setMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null), requestId = useRef<string | null>(null);
  const refresh = useCallback(async () => { const result = await api<{ tasks: TaskSummary[] }>('/api/tasks'); setTasks(result.tasks); }, []);
  useEffect(() => { let active = true; refresh().catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [refresh]);
  async function openTask(id: string) { setError(''); setReviewed(false); setConfirmed(false); setBusy(true); try { setDetail(await api<TaskDetails>(`/api/tasks/${id}`)); setView('detail'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  function change<K extends keyof Form>(key: K, value: Form[K]) { requestId.current = null; setForm(existing => ({ ...existing, [key]: value })); }
  function begin(sampleData = false) { requestId.current = null; setForm(sampleData ? sample : emptyForm); setError(''); setMessage(''); setView('compose'); }
  async function openSettings() { setError(''); setMessage(''); setBusy(true); try { const value = await api<ModelSettings>('/api/settings'); setSettings(value); setModel(value.model); setApiKey(''); setView('settings'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function saveSettings(event: React.FormEvent) { event.preventDefault(); setError(''); setMessage(''); setBusy(true); try { await api('/api/settings', { method: 'POST', body: JSON.stringify({ model, apiKey }) }); setSettings(await api<ModelSettings>('/api/settings')); setApiKey(''); setMessage('Model settings saved securely.'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function removeSettings() { setBusy(true); setError(''); setMessage(''); try { await api('/api/settings', { method: 'DELETE' }); setSettings(await api<ModelSettings>('/api/settings')); setApiKey(''); setMessage('Model settings removed.'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function analyze() {
    setError(''); setMessage(''); setBusy(true);
    try {
      const result = await api<{ recipient: string; responseText: string; expenseKrw: number | null; participants: Participant[]; model: string }>('/api/analyze', { method: 'POST', body: JSON.stringify({ goal: form.goal, sourceText: form.sourceText }) });
      const csv = (value: string) => `"${value.replace(/[\r\n]+/g, ' ').replace(/"/g, '""')}"`;
      const rows = result.participants.map(person => [person.id, person.name, person.department, person.role].map(csv).join(', ')).join('\n');
      setForm(existing => ({ ...existing, recipient: existing.recipient || result.recipient, responseText: existing.responseText || result.responseText, participantLines: existing.participantLines || rows, expenseKrw: existing.expenseKrw === '0' && result.expenseKrw !== null ? String(result.expenseKrw) : existing.expenseKrw }));
      requestId.current = null; setMessage('Analysis is ready. Review all suggested details before creating the task.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function attach(file?: File) {
    if (!file) return;
    if (file.size > 100000 || !/\.(txt|md|csv)$/i.test(file.name)) { setError('Choose a TXT, Markdown, or CSV file under 100 KB.'); return; }
    try { const content = await file.text(); setForm(existing => ({ ...existing, sourceName: file.name, sourceText: content, isSample: false })); requestId.current = null; setError(''); }
    catch { setError('The file could not be read.'); }
  }
  async function createTask(event: React.FormEvent) {
    event.preventDefault(); setError('');
    try {
      const participants = parseParticipants(form.participantLines), amount = Number(form.expenseKrw.replace(/,/g, ''));
      if (!participants.length) throw new Error('Add at least one participant.');
      if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1000000000) throw new Error('Enter a valid travel expense in KRW.');
      requestId.current ??= crypto.randomUUID(); setBusy(true);
      const result = await api<{ id: string }>('/api/tasks', { method: 'POST', body: JSON.stringify({ requestId: requestId.current, goal: form.goal, sourceName: form.sourceName, sourceText: form.sourceText, participants, recipient: form.recipient, responseText: form.responseText, expenseKrw: amount, isSample: form.isSample }) });
      await refresh(); await openTask(result.id); requestId.current = null;
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function action(name: string, checked = false) {
    if (!detail || busy) return;
    setBusy(true); setError('');
    try {
      await api(`/api/tasks/${detail.task.id}`, { method: 'POST', body: JSON.stringify({ action: name, version: detail.task.version, confirmed: checked }) });
      setDetail(await api<TaskDetails>(`/api/tasks/${detail.task.id}`)); await refresh(); setReviewed(false); setConfirmed(false);
    } catch (e) { setError((e as Error).message); try { setDetail(await api<TaskDetails>(`/api/tasks/${detail.task.id}`)); } catch {} }
    finally { setBusy(false); }
  }
  async function downloadEvidence() {
    if (!detail) return; setBusy(true); setError('');
    try { const evidence = await api(`/api/tasks/${detail.task.id}/evidence`); const blob = new Blob([JSON.stringify(evidence, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'actflow-evidence.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const attention = tasks.filter(task => ['WAITING_APPROVAL', 'FAILED'].includes(task.status)).length;
  const visible = tasks.filter(task => (filter === 'all' || (filter === 'attention' && ['WAITING_APPROVAL', 'FAILED'].includes(task.status)) || (filter === 'active' && ['DRAFT', 'RUNNING', 'READY'].includes(task.status)) || (filter === 'completed' && task.status === 'COMPLETED')) && [task.title, task.goal].some(value => value.toLowerCase().includes(query.toLowerCase().trim())));
  const task = detail?.task;

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => { setView('tasks'); setError(''); }}><span className="brand-mark"><ListChecks size={20}/></span><strong>ActFlow</strong></button>
      <div className="side-workspace"><span className="workspace-avatar">W</span><span><strong>My workspace</strong><small>Keep your work moving</small></span></div>
      <p className="side-label">WORKSPACE</p>
      <button className={`side-link ${(view === 'tasks' && filter !== 'attention') || view === 'compose' ? 'active' : ''}`} onClick={() => { setView('tasks'); setFilter('all'); setError(''); }}><ListChecks size={18}/> Tasks <span>{tasks.length}</span></button>
      <button className={`side-link ${view === 'tasks' && filter === 'attention' ? 'active' : ''}`} onClick={() => { setView('tasks'); setFilter('attention'); setError(''); }}><ShieldCheck size={18}/> Approvals <span>{attention || ''}</span></button>
      <button className={`side-link ${view === 'settings' ? 'active' : ''}`} onClick={() => void openSettings()}><Settings2 size={18}/> Settings</button>
      <div className="side-bottom"><ShieldCheck size={19}/><strong>Important decisions<br/>stay in your hands.</strong><p>Review approvals and results whenever you need to.</p><span>FROM INTENT TO DONE</span></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div><span>Workspace</span><span className="crumb">/</span><strong>{view === 'detail' ? 'Task details' : view === 'compose' ? 'New task' : view === 'settings' ? 'Settings' : 'Tasks'}</strong></div><div className="top-user"><span className="live-dot"/> PRIVATE WORKSPACE <span className="user-avatar">{displayName.slice(0,1).toUpperCase()}</span><span className="username">{displayName}</span></div></header>
      <main className="content">
        {error && <div className="error" role="alert"><CircleAlert size={18}/><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={16}/></button></div>}
        {message && <div className="success" role="status"><CheckCircle2 size={18}/>{message}</div>}
        {view === 'tasks' && <>
          <div className="page-head"><div><p className="eyebrow">YOUR WORK, MOVING FORWARD</p><h1>What can we help you finish?</h1><p>From a clear goal to a result you can review.</p></div><button className="button primary" onClick={() => begin()}><Plus size={17}/> New task</button></div>
          <div className="intro-grid"><section className="start-card"><div className="card-overline"><span className="icon-box"><Sparkles size={19}/></span> GET STARTED</div><h2>Give your task<br/>a clear beginning.</h2><p>Add a goal, your participant details, and the document you want to prepare.</p><button className="button primary" onClick={() => begin()}>Create a task <ArrowRight size={17}/></button></section>
          <aside className="sample-card"><span className="small-caps">FIRST TIME HERE?</span><FileCheck2 size={26}/><h2>See a complete<br/>workflow in action.</h2><p>Try a training notice with sample participants and an approval step.</p><button className="button light" onClick={() => begin(true)}>Use sample task <ArrowUpRight size={16}/></button><small>Clearly labeled sample data</small></aside></div>
          <section className="panel tasks-panel"><div className="section-heading"><div><h2>My tasks <span className="count">{tasks.length}</span></h2><p>Follow the work that needs your attention.</p></div><label className="search"><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search tasks" aria-label="Search tasks"/></label></div>
            <div className="filters">{([['all','All'],['attention','Needs attention'],['active','In progress'],['completed','Completed']] as const).map(([id,label]) => <button key={id} className={filter === id ? 'selected' : ''} onClick={() => setFilter(id)} aria-pressed={filter === id}>{label}</button>)}</div>
            {loading ? <div className="empty"><LoaderCircle className="spin"/> Loading your workspace…</div> : visible.length ? <div className="task-list">{visible.map(item => <button className="task-row" key={item.id} onClick={() => void openTask(item.id)}><span className="row-icon">{item.status === 'WAITING_APPROVAL' ? <CircleAlert size={19}/> : item.status === 'COMPLETED' ? <CheckCircle2 size={19}/> : <FileText size={19}/>}</span><span className="row-main"><strong>{item.title}</strong><small>{item.is_sample ? 'Sample data · ' : ''}Updated {time(item.updated_at)}</small></span><Badge status={item.status}/><ArrowUpRight className="row-arrow" size={17}/></button>)}</div> : <div className="empty"><span className="empty-icon"><ListChecks size={23}/></span><strong>{tasks.length ? 'No tasks match this view.' : 'Your first task can start here.'}</strong><p>{tasks.length ? 'Try another search or filter.' : 'Create a task or use the sample to see how it works.'}</p><button className="button outline" onClick={() => begin()}>Create a task <ArrowRight size={15}/></button></div>}
          </section>
        </>}
        {view === 'compose' && <><button className="back" onClick={() => { setView('tasks'); setError(''); }}><ArrowLeft size={16}/> All tasks</button><div className="page-head compact"><div><p className="eyebrow">NEW TASK</p><h1>Start with the details.</h1><p>Provide the information used to create your files.</p></div>{form.isSample && <span className="sample-tag">SAMPLE DATA</span>}</div>
          <form className="panel compose" onSubmit={createTask}><div className="form-section"><div className="form-title"><span className="number">01</span><div><h2>Goal &amp; context</h2><p>Describe the result you need and add a source document if useful.</p></div></div>
            <label>What would you like to prepare?<textarea required maxLength={20000} rows={3} value={form.goal} onChange={e => change('goal', e.target.value)} placeholder="For example: prepare a training participant list and a response."/></label>
            <div className="upload-line"><input ref={fileInput} hidden type="file" accept=".txt,.md,.csv,text/plain,text/csv" onChange={e => void attach(e.target.files?.[0])}/><button type="button" className="button outline" onClick={() => fileInput.current?.click()}><FileUp size={16}/> Add text document</button><span>{form.sourceName || 'TXT, Markdown or CSV · up to 100 KB'}</span></div>
            <label>Source notes <span className="optional">optional</span><textarea rows={4} maxLength={100000} value={form.sourceText} onChange={e => change('sourceText', e.target.value)} placeholder="Paste text from a notice or add context here."/></label><div className="analysis-action"><button type="button" className="button outline" disabled={busy || !form.goal.trim() || !form.sourceText.trim()} onClick={() => void analyze()}><Sparkles size={16}/> Analyze source with NVIDIA</button><span>Suggestions are for your review.</span></div></div>
            <div className="form-section"><div className="form-title"><span className="number">02</span><div><h2>Participants</h2><p>These rows are written into the spreadsheet exactly as entered.</p></div></div>
            <label>One participant per line<textarea required rows={4} value={form.participantLines} onChange={e => change('participantLines', e.target.value)} placeholder={'E001, Alex Kim, Operations, Manager\nE002, Jordan Lee, Design, Specialist'}/><small>Format: employee ID, name, department, role</small></label></div>
            <div className="form-section"><div className="form-title"><span className="number">03</span><div><h2>Response &amp; expense</h2><p>Your response is saved as a review draft. No email is sent.</p></div></div>
              <div className="form-grid"><label>Recipient<input required maxLength={200} value={form.recipient} onChange={e => change('recipient', e.target.value)} placeholder="Training Operations"/></label><label>Estimated travel expense <span className="optional">KRW</span><input required inputMode="numeric" value={form.expenseKrw} onChange={e => change('expenseKrw', e.target.value)} placeholder="0"/></label></div>
              <label>Response draft<textarea required maxLength={10000} rows={4} value={form.responseText} onChange={e => change('responseText', e.target.value)} placeholder="Write the message to include in the document."/></label><div className="notice"><ShieldCheck size={16}/> Expenses of KRW 100,000 or more pause for your review.</div></div>
            <div className="form-footer"><span><ShieldCheck size={15}/> Your workspace saves the task and its history.</span><button className="button primary" disabled={busy} type="submit">{busy ? <><LoaderCircle className="spin" size={16}/> Saving…</> : <>Create task <ArrowRight size={16}/></>}</button></div>
          </form></>}
        {view === 'settings' && <><button className="back" onClick={() => { setView('tasks'); setError(''); setMessage(''); }}><ArrowLeft size={16}/> All tasks</button><div className="page-head compact"><div><p className="eyebrow">WORKSPACE SETTINGS</p><h1>Model connection</h1><p>Use an NVIDIA model through Nebius Token Factory for source analysis.</p></div></div><form className="panel compose settings-form" onSubmit={saveSettings}><div className="form-section"><div className="form-title"><span className="number"><Settings2 size={16}/></span><div><h2>Nebius · NVIDIA</h2><p>{settings?.connected ? 'Connection details are saved for your workspace.' : 'Add connection details for document analysis.'}</p></div></div><label>Model ID<input required maxLength={150} value={model} onChange={e => setModel(e.target.value)}/></label><label>Nebius token<input type="password" required autoComplete="off" minLength={8} maxLength={2048} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={settings?.connected ? 'Enter a new token to replace the saved token' : 'Enter token'}/><small>The token is encrypted before it is saved and is never shown again.</small></label></div><div className="form-footer"><span><ShieldCheck size={15}/> Only this workspace can use its saved connection.</span><div className="inline-actions">{settings?.connected && <button type="button" className="button outline" disabled={busy} onClick={() => void removeSettings()}>Remove</button>}<button className="button primary" disabled={busy} type="submit">Save connection <ArrowRight size={16}/></button></div></div></form></>}
        {view === 'detail' && task && detail && <><button className="back" onClick={() => { setView('tasks'); setError(''); }}><ArrowLeft size={16}/> All tasks</button><div className="detail-header"><div><p className="eyebrow">YOUR TASK {task.is_sample ? ' / SAMPLE DATA' : ''}</p><h1>{task.title}</h1><p>{task.goal}</p></div><Badge status={task.status}/></div>
          <div className="status-bar"><div><span>Current status</span><strong>{labels[task.status]}</strong></div><div className="status-actions">{task.status === 'DRAFT' && <button className="button primary" disabled={busy} onClick={() => void action('prepare')}>Prepare files <ArrowRight size={16}/></button>}{task.status === 'FAILED' && <button className="button primary" disabled={busy} onClick={() => void action('retry')}>Try again <ArrowRight size={16}/></button>}{busy && <LoaderCircle className="spin" size={19}/>}</div></div>
          {task.status === 'WAITING_APPROVAL' && <section className="approval-card"><div className="approval-top"><span className="approval-icon"><ShieldCheck size={21}/></span><div><p className="small-caps">HUMAN DECISION REQUIRED</p><h2>Approval required to continue</h2></div><span className="approval-tag">APPROVAL</span></div><div className="approval-grid"><div><span>Action</span><strong>Review travel expense</strong></div><div><span>Why it paused</span><strong>KRW {task.expense_krw.toLocaleString()} · approval required</strong></div><div><span>Information used</span><strong>The expense entered for this task</strong></div><div><span>External effect</span><strong>No payment or email will be sent</strong></div></div><label className="check-row"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)}/> I have reviewed this action and its conditions.</label><div className="inline-actions"><button className="button outline" disabled={busy} onClick={() => void action('reject')}>Reject</button><button className="button primary" disabled={busy || !reviewed} onClick={() => void action('approve', true)}>Approve and continue <ArrowRight size={15}/></button></div></section>}
          {task.status === 'REJECTED' && <div className="notice prominent"><CircleAlert size={18}/> This request was rejected. No generated files were created.</div>}
          {task.status === 'DRAFT' && <div className="notice prominent"><ShieldCheck size={18}/> Review the details below, then prepare the files. Approval is required for travel expenses of KRW 100,000 or more.</div>}
          {task.status === 'FAILED' && <div className="notice prominent"><CircleAlert size={18}/> File preparation was interrupted. You can try again.</div>}
          {task.status === 'COMPLETED' && <div className="success"><CheckCircle2 size={18}/> You reviewed the results and confirmed this task as complete.</div>}
          <div className="detail-grid"><section className="panel"><div className="panel-title"><div><p className="eyebrow">TASK OUTPUTS</p><h2>Generated files</h2></div><FileCheck2 size={20}/></div>{detail.artifacts.length ? <><div className="files">{detail.artifacts.map((file: Artifact) => <a className="file" key={file.id} href={`/api/artifacts/${file.id}`}><span className="file-icon">{file.format.toUpperCase()}</span><span><strong>{file.name}</strong><small>Integrity checked on download · {(file.byte_size / 1024).toFixed(1)} KB</small></span><Download size={17}/></a>)}</div><button className="text-button" disabled={busy} onClick={() => void downloadEvidence()}>Download verification summary <Download size={15}/></button></> : <div className="placeholder"><FileText size={22}/><strong>Your files will appear here.</strong><p>Prepare the task to create the participant list and response draft.</p></div>}</section>
            <section className="panel"><div className="panel-title"><div><p className="eyebrow">YOUR WORK</p><h2>Task details</h2></div><FileText size={20}/></div><dl className="details-list"><div><dt>Source</dt><dd>{task.source_name}</dd></div><div><dt>Participants</dt><dd>{JSON.parse(task.participants_json).length} people</dd></div><div><dt>Recipient</dt><dd>{task.recipient}</dd></div><div><dt>Travel expense</dt><dd>KRW {task.expense_krw.toLocaleString()}</dd></div></dl><details className="disclosure"><summary>View participant list and response</summary><ul>{(JSON.parse(task.participants_json) as Participant[]).map(person => <li key={person.id}>{person.name} · {person.department} · {person.role}</li>)}</ul><p>{task.response_text}</p>{task.source_text && <><strong>Source notes</strong><p className="source-text">{task.source_text}</p></>}</details></section></div>
          {task.status === 'READY' && <section className="panel complete-card"><div><p className="eyebrow">FINAL REVIEW</p><h2>Is the task complete?</h2><p>Download and review the files before confirming. No email is sent by this workflow.</p><label className="check-row"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/> I have reviewed the files and confirm this task is complete.</label></div><button className="button primary" disabled={busy || !confirmed} onClick={() => void action('complete', true)}>Confirm completion <Check size={16}/></button></section>}
          <section className="panel timeline"><div className="panel-title"><div><p className="eyebrow">TRANSPARENT BY DESIGN</p><h2>Task activity</h2></div><Clock3 size={20}/></div>{detail.events.map(event => <div className="event" key={event.id}><span className="event-dot"/><div><strong>{event.detail}</strong><small>{time(event.created_at)}</small></div></div>)}</section>
        </>}
      </main>
    </div>
  </div>;
}
