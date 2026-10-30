CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  owner_session_id TEXT NOT NULL DEFAULT 'actflow-local-demo',
  source_name TEXT NOT NULL,
  source_mime TEXT,
  source_sha256 TEXT,
  source_path TEXT,
  source_text TEXT,
  status TEXT NOT NULL CHECK(status IN ('DRAFT','ANALYZED','RUNNING','WAITING','COMPLETED','FAILED','PAUSED')),
  execution_mode TEXT NOT NULL CHECK(execution_mode IN ('MANUAL','PRE_EXECUTION')),
  pre_execution_enabled INTEGER NOT NULL DEFAULT 0 CHECK(pre_execution_enabled IN (0,1)),
  analysis_json TEXT,
  provider_json TEXT,
  error_code TEXT,
  error_message TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  living_task_id TEXT REFERENCES living_tasks(id)
);
CREATE TABLE IF NOT EXISTS source_documents (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  display_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  parse_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(parse_status IN ('PENDING','PARSED','FAILED')),
  parse_error TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  source TEXT,
  quote_or_locator TEXT
);
CREATE TABLE IF NOT EXISTS workflow_nodes (
  id TEXT NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING','READY','PREPARING','WAITING','RUNNING','COMPLETED','VERIFIED','REJECTED','ROLLED_BACK','FAILED','BLOCKED')),
  policy_class TEXT NOT NULL CHECK(policy_class IN ('AUTO','CONFIRM','APPROVAL','HUMAN_ONLY')),
  policy_json TEXT NOT NULL,
  task_json TEXT NOT NULL,
  expected_output TEXT,
  result_json TEXT,
  error_message TEXT,
  started_at TEXT,
  finished_at TEXT,
  PRIMARY KEY(workflow_id,id)
);
CREATE TABLE IF NOT EXISTS workflow_edges (
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  condition TEXT NOT NULL CHECK(condition IN ('always','approved','rejected','confirmed','declined')),
  PRIMARY KEY(workflow_id,from_id,to_id,condition)
);
CREATE TABLE IF NOT EXISTS policy_decisions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  node_id TEXT NOT NULL,
  policy_class TEXT NOT NULL CHECK(policy_class IN ('AUTO','CONFIRM','APPROVAL','HUMAN_ONLY')),
  policy_version INTEGER NOT NULL,
  matched_rules_json TEXT NOT NULL,
  model_suggestion TEXT,
  override_reason TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recorder_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  node_id TEXT,
  event_type TEXT NOT NULL,
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recorder_workflow ON recorder_events(workflow_id,sequence);
CREATE TRIGGER IF NOT EXISTS recorder_no_update BEFORE UPDATE ON recorder_events BEGIN SELECT RAISE(ABORT,'recorder is append only'); END;
CREATE TRIGGER IF NOT EXISTS recorder_no_delete BEFORE DELETE ON recorder_events BEGIN SELECT RAISE(ABORT,'recorder is append only'); END;
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  node_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('CONFIRM','APPROVAL')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
  version INTEGER NOT NULL DEFAULT 0,
  workflow_version INTEGER NOT NULL,
  policy_version INTEGER NOT NULL,
  requested_by TEXT,
  resolved_by TEXT,
  resolved_role TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(workflow_id,node_id)
);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  node_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('TEMPORARY','COMMITTED','DELETED','DELETE_FAILED')),
  byte_size INTEGER NOT NULL,
  sha256 TEXT,
  content_type TEXT NOT NULL,
  preparation_key TEXT,
  verification_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(verification_status IN ('PENDING','VERIFIED','FAILED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artifacts_workflow ON artifacts(workflow_id,state);
CREATE TABLE IF NOT EXISTS verifications (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  artifact_id TEXT REFERENCES artifacts(id),
  node_id TEXT,
  passed INTEGER NOT NULL CHECK(passed IN (0,1)),
  verifier_version TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS organization_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  policy_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  execution_mode TEXT NOT NULL CHECK(execution_mode IN ('MANUAL','PRE_EXECUTION')),
  pre_execution_enabled INTEGER NOT NULL CHECK(pre_execution_enabled IN (0,1)),
  provider_id TEXT NOT NULL CHECK(provider_id IN ('demo','nebius')),
  model TEXT NOT NULL,
  effort TEXT,
  organization_policy_version INTEGER NOT NULL DEFAULT 1,
  automation_profile TEXT NOT NULL DEFAULT 'SAFE',
  auto_continue_enabled INTEGER NOT NULL DEFAULT 0,
  project_memory_enabled INTEGER NOT NULL DEFAULT 1,
  email_task_detection_enabled INTEGER NOT NULL DEFAULT 1,
  auto_link_work_enabled INTEGER NOT NULL DEFAULT 1,
  replan_on_new_info_enabled INTEGER NOT NULL DEFAULT 1,
  retry_failed_steps_enabled INTEGER NOT NULL DEFAULT 1,
  security_level TEXT NOT NULL DEFAULT 'HIGH',
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO settings(id,execution_mode,pre_execution_enabled,provider_id,model,effort,organization_policy_version,automation_profile,auto_continue_enabled,project_memory_enabled,email_task_detection_enabled,auto_link_work_enabled,replan_on_new_info_enabled,retry_failed_steps_enabled,security_level,updated_at)
VALUES (1,'MANUAL',0,'nebius','nvidia/nemotron-3-super-120b-a12b',NULL,1,'SAFE',0,1,1,1,1,1,'HIGH',datetime('now'));
CREATE TABLE IF NOT EXISTS encrypted_credentials (
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  tag TEXT NOT NULL,
  masked_hint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(session_id,provider)
);


CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_session_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','PAUSED','ARCHIVED')),
  summary TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_owner_status ON projects(owner_session_id,status,updated_at);

CREATE TABLE IF NOT EXISTS living_tasks (
  id TEXT PRIMARY KEY,
  owner_session_id TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id),
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('DRAFT','READY','RUNNING','WAITING_EVENT','WAITING_APPROVAL','PAUSED','COMPLETED','FAILED','CANCELLED','BLOCKED')),
  execution_mode TEXT NOT NULL CHECK(execution_mode IN ('MANUAL','PRE_EXECUTION')),
  background_watch_enabled INTEGER NOT NULL DEFAULT 0 CHECK(background_watch_enabled IN (0,1)),
  speculative_preparation_enabled INTEGER NOT NULL DEFAULT 0 CHECK(speculative_preparation_enabled IN (0,1)),
  current_workflow_id TEXT REFERENCES workflows(id),
  agent_session_id TEXT,
  next_action_summary TEXT,
  waiting_reason TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_owner_status ON living_tasks(owner_session_id,status,updated_at);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON living_tasks(project_id,status,updated_at);

CREATE TABLE IF NOT EXISTS memory_entries (
  id TEXT PRIMARY KEY,
  owner_session_id TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id),
  living_task_id TEXT REFERENCES living_tasks(id),
  scope TEXT NOT NULL CHECK(scope IN ('USER','PROJECT','TASK','DECISION','EVIDENCE')),
  memory_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  supersedes_id TEXT REFERENCES memory_entries(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_owner_scope ON memory_entries(owner_session_id,scope,active,updated_at);
CREATE INDEX IF NOT EXISTS idx_memory_task ON memory_entries(living_task_id,active,updated_at);
CREATE INDEX IF NOT EXISTS idx_memory_project ON memory_entries(project_id,active,updated_at);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  living_task_id TEXT NOT NULL UNIQUE REFERENCES living_tasks(id),
  owner_session_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  provider_session_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','PAUSED','CLOSED')),
  context_version INTEGER NOT NULL DEFAULT 0,
  checkpoint_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trigger_subscriptions (
  id TEXT PRIMARY KEY,
  owner_session_id TEXT NOT NULL,
  living_task_id TEXT NOT NULL REFERENCES living_tasks(id),
  type TEXT NOT NULL CHECK(type IN ('EMAIL','TIME','WEBHOOK','MANUAL','FILE_CHANGE','GIT_CHANGE','CALENDAR','WEB_CHANGE')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  config_json TEXT NOT NULL,
  next_due_at TEXT,
  last_fired_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_triggers_due ON trigger_subscriptions(enabled,type,next_due_at);
CREATE INDEX IF NOT EXISTS idx_triggers_task ON trigger_subscriptions(living_task_id,enabled);

CREATE TABLE IF NOT EXISTS wake_events (
  id TEXT PRIMARY KEY,
  owner_session_id TEXT NOT NULL,
  living_task_id TEXT NOT NULL REFERENCES living_tasks(id),
  trigger_id TEXT NOT NULL REFERENCES trigger_subscriptions(id),
  event_key TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('EMAIL','TIME','WEBHOOK','MANUAL','FILE_CHANGE','GIT_CHANGE','CALENDAR','WEB_CHANGE')),
  status TEXT NOT NULL CHECK(status IN ('PENDING','PROCESSING','PROCESSED','FAILED')),
  planning_retries INTEGER NOT NULL DEFAULT 0 CHECK(planning_retries BETWEEN 0 AND 1),
  payload_json TEXT NOT NULL,
  claimed_by TEXT,
  claimed_at TEXT,
  processed_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(trigger_id,event_key)
);
CREATE INDEX IF NOT EXISTS idx_wake_task_status ON wake_events(living_task_id,status,created_at);

CREATE TABLE IF NOT EXISTS verified_contacts (
  id TEXT PRIMARY KEY,
  owner_session_id TEXT NOT NULL,
  email_address TEXT NOT NULL,
  display_name TEXT,
  auto_reply_enabled INTEGER NOT NULL DEFAULT 1 CHECK(auto_reply_enabled IN (0,1)),
  verified_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_session_id,email_address)
);

CREATE TABLE IF NOT EXISTS task_evidence (
  id TEXT PRIMARY KEY,
  owner_session_id TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id),
  living_task_id TEXT REFERENCES living_tasks(id),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  category TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT,
  observed_at TEXT NOT NULL,
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  milestone_weight REAL,
  milestone_progress REAL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_scope ON task_evidence(owner_session_id,project_id,living_task_id,observed_at);

CREATE TABLE IF NOT EXISTS mail_messages (
  id TEXT PRIMARY KEY,
  owner_session_id TEXT NOT NULL,
  living_task_id TEXT NOT NULL REFERENCES living_tasks(id),
  message_id TEXT NOT NULL,
  thread_id TEXT,
  direction TEXT NOT NULL CHECK(direction IN ('INBOUND','OUTBOUND')),
  from_address TEXT NOT NULL,
  from_display_name TEXT,
  reply_to_address TEXT,
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  auth_json TEXT NOT NULL DEFAULT '{}',
  workflow_id TEXT REFERENCES workflows(id),
  created_at TEXT NOT NULL,
  UNIQUE(owner_session_id,message_id)
);
CREATE INDEX IF NOT EXISTS idx_mail_owner_thread ON mail_messages(owner_session_id,thread_id,created_at);
CREATE INDEX IF NOT EXISTS idx_mail_task ON mail_messages(living_task_id,created_at);

-- Release hardening: additive, owner-scoped routing; canonical state stays in ActFlow.
CREATE TABLE IF NOT EXISTS model_preferences (
  owner_session_id TEXT PRIMARY KEY,
  preferences_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_activity (
  id TEXT PRIMARY KEY,
  owner_session_id TEXT NOT NULL,
  living_task_id TEXT REFERENCES living_tasks(id),
  event_type TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_activity_task ON agent_activity(owner_session_id,living_task_id,created_at);
CREATE TRIGGER IF NOT EXISTS activity_no_update BEFORE UPDATE ON agent_activity BEGIN SELECT RAISE(ABORT,'activity is append only'); END;
CREATE TRIGGER IF NOT EXISTS activity_no_delete BEFORE DELETE ON agent_activity BEGIN SELECT RAISE(ABORT,'activity is append only'); END;
CREATE TABLE IF NOT EXISTS task_episodes (
  wake_event_id TEXT PRIMARY KEY REFERENCES wake_events(id),
  living_task_id TEXT NOT NULL REFERENCES living_tasks(id),
  workflow_id TEXT NOT NULL UNIQUE REFERENCES workflows(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mail_outbox (
  id TEXT PRIMARY KEY,
  owner_session_id TEXT NOT NULL,
  living_task_id TEXT NOT NULL REFERENCES living_tasks(id),
  workflow_id TEXT NOT NULL UNIQUE REFERENCES workflows(id),
  inbound_message_id TEXT NOT NULL,
  draft_hash TEXT NOT NULL,
  draft_json TEXT NOT NULL,
  requires_approval INTEGER NOT NULL CHECK(requires_approval IN (0,1)),
  status TEXT NOT NULL CHECK(status IN ('READY','SENDING','SENT','UNKNOWN','BLOCKED')),
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_session_id,inbound_message_id,draft_hash)
);

-- Backend-owned episode/source/inbound bindings. Additive; no existing data is reset.
CREATE TABLE IF NOT EXISTS task_episode_context (
  workflow_id TEXT PRIMARY KEY REFERENCES workflows(id),
  living_task_id TEXT NOT NULL REFERENCES living_tasks(id),
  owner_session_id TEXT NOT NULL,
  inbound_message_id TEXT,
  is_document_source INTEGER NOT NULL DEFAULT 0 CHECK(is_document_source IN (0,1)),
  reply_status TEXT NOT NULL DEFAULT 'NONE' CHECK(reply_status IN ('NONE','PENDING','DISPATCHED','FAILED')),
  reply_workflow_id TEXT REFERENCES workflows(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_episode_context_task ON task_episode_context(owner_session_id,living_task_id);
CREATE INDEX IF NOT EXISTS idx_episode_pending_reply ON task_episode_context(reply_status);

-- Stable owner-scoped creation retries; no duplicate task after a lost HTTP response.
CREATE TABLE IF NOT EXISTS task_creation_requests (
  owner_session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES living_tasks(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(owner_session_id,request_id)
);

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('USER','APPROVER')),
  disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_session_expiry ON app_sessions(expires_at);
CREATE TABLE IF NOT EXISTS login_attempts (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gmail_connections (
  owner_session_id TEXT PRIMARY KEY,
  email_address TEXT NOT NULL,
  secret_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  watch_enabled INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gmail_oauth_states (
  state_hash TEXT PRIMARY KEY,
  owner_session_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  verifier TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gmail_imports (
  owner_session_id TEXT NOT NULL,
  gmail_message_id TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY(owner_session_id,gmail_message_id)
);
CREATE TABLE IF NOT EXISTS worker_health (id INTEGER PRIMARY KEY CHECK(id=1),last_tick_at TEXT NOT NULL,last_error TEXT);
CREATE TABLE IF NOT EXISTS goal_contracts (
  living_task_id TEXT PRIMARY KEY REFERENCES living_tasks(id),
  owner_session_id TEXT NOT NULL,
  goal_hash TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  confirmed_version INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS goal_requirements (
  id TEXT PRIMARY KEY,
  living_task_id TEXT NOT NULL REFERENCES goal_contracts(living_task_id),
  requirement_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('STEP','ARTIFACT','FACT','MAIL','OWNER')),
  label TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  owner_confirmed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(living_task_id,requirement_key)
);
CREATE TABLE IF NOT EXISTS task_repairs (
  failed_workflow_id TEXT PRIMARY KEY REFERENCES workflows(id),
  living_task_id TEXT NOT NULL REFERENCES living_tasks(id),
  created_at TEXT NOT NULL
);
