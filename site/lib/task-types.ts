export type Participant = { id: string; name: string; department: string; role: string };
export type TaskStatus = 'DRAFT' | 'WAITING_APPROVAL' | 'RUNNING' | 'READY' | 'REJECTED' | 'FAILED' | 'COMPLETED';
export type Task = {
  id: string; title: string; goal: string; source_name: string; source_text: string;
  participants_json: string; recipient: string; response_text: string; expense_krw: number;
  is_sample: number; status: TaskStatus; version: number; created_at: string;
  updated_at: string; completed_at: string | null;
};
export type TaskEvent = { id: string; kind: string; detail: string; created_at: string };
export type Artifact = { id: string; name: string; format: 'xlsx' | 'docx'; sha256: string; byte_size: number; created_at: string };
export type TaskDetails = { task: Task; events: TaskEvent[]; artifacts: Artifact[] };
