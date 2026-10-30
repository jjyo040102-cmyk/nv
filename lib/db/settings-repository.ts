import type Database from "better-sqlite3";
import type { ExecutionMode, ProviderId } from "../domain/types";
import type { AutomationProfile, SecurityLevel } from "../tasks/types";

export type AppSettings = {
  executionMode: ExecutionMode;
  preExecutionEnabled: boolean;
  providerId: ProviderId;
  model: string;
  effort: string | null;
  organizationPolicyVersion: number;
  automationProfile?: AutomationProfile;
  autoContinueEnabled?: boolean;
  projectMemoryEnabled?: boolean;
  emailTaskDetectionEnabled?: boolean;
  autoLinkWorkEnabled?: boolean;
  replanOnNewInfoEnabled?: boolean;
  retryFailedStepsEnabled?: boolean;
  securityLevel?: SecurityLevel;
};

type SettingsRow = {
  execution_mode: ExecutionMode;
  pre_execution_enabled: number;
  provider_id: ProviderId;
  model: string;
  effort: string | null;
  organization_policy_version: number;
  automation_profile: AutomationProfile;
  auto_continue_enabled: number;
  project_memory_enabled: number;
  email_task_detection_enabled: number;
  auto_link_work_enabled: number;
  replan_on_new_info_enabled: number;
  retry_failed_steps_enabled: number;
  security_level: SecurityLevel;
};

export class SettingsRepository {
  constructor(protected readonly db: Database.Database) {}

  getSettings(): AppSettings {
    const row = this.db.prepare("SELECT * FROM settings WHERE id = 1").get() as SettingsRow | undefined;
    if (!row) throw new Error("Settings have not been migrated");
    return {
      executionMode: row.execution_mode,
      preExecutionEnabled: row.pre_execution_enabled === 1,
      providerId: row.provider_id,
      model: row.model,
      effort: row.effort,
      organizationPolicyVersion: row.organization_policy_version,
      automationProfile: row.automation_profile,
      autoContinueEnabled: row.auto_continue_enabled === 1,
      projectMemoryEnabled: row.project_memory_enabled === 1,
      emailTaskDetectionEnabled: row.email_task_detection_enabled === 1,
      autoLinkWorkEnabled: row.auto_link_work_enabled === 1,
      replanOnNewInfoEnabled: row.replan_on_new_info_enabled === 1,
      retryFailedStepsEnabled: row.retry_failed_steps_enabled === 1,
      securityLevel: row.security_level
    };
  }

  updateSettings(input: Partial<AppSettings>): AppSettings {
    const current = this.getSettings();
    const next = { ...current, ...input };
    this.db.prepare(`UPDATE settings SET
      execution_mode=?, pre_execution_enabled=?, provider_id=?, model=?, effort=?, organization_policy_version=?,
      automation_profile=?, auto_continue_enabled=?, project_memory_enabled=?, email_task_detection_enabled=?,
      auto_link_work_enabled=?, replan_on_new_info_enabled=?, retry_failed_steps_enabled=?, security_level=?, updated_at=? WHERE id=1`)
      .run(next.executionMode, Number(next.preExecutionEnabled), next.providerId, next.model, next.effort, next.organizationPolicyVersion,
        (next.automationProfile ?? "SAFE"), Number(next.autoContinueEnabled ?? false), Number(next.projectMemoryEnabled ?? true), Number(next.emailTaskDetectionEnabled ?? true),
        Number(next.autoLinkWorkEnabled ?? true), Number(next.replanOnNewInfoEnabled ?? true), Number(next.retryFailedStepsEnabled ?? true), (next.securityLevel ?? "HIGH"), new Date().toISOString());
    return this.getSettings();
  }
}
