import type { NodeKind, WorkflowAnalysis, WorkflowEdge, WorkflowTask } from "../domain/types";

const actionKinds: Readonly<Record<string, NodeKind>> = {
  "employee.lookup": "DATA_LOOKUP",
  "artifact.xlsx.participants": "DOCUMENT_GENERATION",
  "artifact.docx.response": "DOCUMENT_GENERATION",
  "expense.process": "APPROVAL",
  "demo.email.simulate": "EXTERNAL_ACTION",
  "workflow.complete": "COMPLETION"
};

export function topologicalTasks(tasks: WorkflowTask[]): WorkflowTask[] {
  const byId = new Map(tasks.map(task => [task.id, task]));
  if (byId.size !== tasks.length) throw new Error("Duplicate workflow task id");
  const ordered: WorkflowTask[] = [], visiting = new Set<string>(), visited = new Set<string>();
  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error("Cyclic workflow graph");
    const task = byId.get(id);
    if (!task) throw new Error("Unknown task dependency");
    visiting.add(id);
    for (const dependency of task.dependsOn) visit(dependency);
    visiting.delete(id); visited.add(id); ordered.push(task);
  }
  for (const task of tasks) visit(task.id);
  return ordered;
}

export function normalizeExpenseKrw(value: string): string {
  const text = value.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) throw new Error("Expense amount must be a nonnegative KRW integer");
  const amount = Number(text.replaceAll(",", ""));
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Expense amount is outside the supported range");
  return String(amount);
}

/** The normalized edges and dependencies describe exactly the same DAG. */
export function normalizeWorkflowAnalysis(analysis: WorkflowAnalysis): WorkflowAnalysis {
  const keys = new Set<string>();
  const facts = analysis.facts.map(fact => {
    if (keys.has(fact.key)) throw new Error("Duplicate fact key");
    keys.add(fact.key);
    return { ...fact, value: fact.key === "expenseKrw" ? normalizeExpenseKrw(fact.value) : fact.value };
  });
  if (analysis.tasks.some(task => task.actionType === "expense.process") && !keys.has("expenseKrw")) throw new Error("Expense review requires an explicit amount");

  const tasks = analysis.tasks.map(task => {
    if (task.condition !== null) throw new Error("Free-text task conditions are unsupported");
    if (new Set(task.dependsOn).size !== task.dependsOn.length) throw new Error("Duplicate task dependency");
    return { ...task, kind: actionKinds[task.actionType] ?? task.kind, dependsOn: [...task.dependsOn] };
  });
  const byId = new Map(tasks.map(task => [task.id, task]));
  if (byId.size !== tasks.length) throw new Error("Duplicate workflow task id");
  const edges: WorkflowEdge[] = [], pairs = new Set<string>();
  for (const edge of analysis.edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to) || edge.from === edge.to) throw new Error("Unknown or self graph edge");
    if (!["always", "approved", "confirmed"].includes(edge.condition)) throw new Error("Rejected and declined branches are unsupported");
    const pair = JSON.stringify([edge.from, edge.to]);
    if (pairs.has(pair)) throw new Error("Duplicate or conflicting graph edge");
    pairs.add(pair); edges.push({ ...edge });
    const destination = byId.get(edge.to)!;
    if (!destination.dependsOn.includes(edge.from)) destination.dependsOn.push(edge.from);
  }
  for (const task of tasks) for (const dependency of task.dependsOn) {
    if (!byId.has(dependency) || dependency === task.id) throw new Error("Unknown or self task dependency");
    const pair = JSON.stringify([dependency, task.id]);
    if (!pairs.has(pair)) {
      pairs.add(pair); edges.push({ from: dependency, to: task.id, condition: "always" });
    }
  }
  return { ...analysis, facts, tasks: topologicalTasks(tasks), edges };
}
