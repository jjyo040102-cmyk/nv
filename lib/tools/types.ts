import type { PolicyClass, WorkflowAnalysis } from "../domain/types";
import type Database from "better-sqlite3";
import type { ArtifactWorkspace } from "../artifacts/workspace";
import type { ParticipantRow } from "../artifacts/xlsxGenerator";

export type ToolContext = {
  workflowId: string;
  nodeId: string;
  workspace?: ArtifactWorkspace;
  analysis?: WorkflowAnalysis;
  participantRows?: ParticipantRow[];
  preparationKey?: string;
  db?: Database.Database;
  dataDir?: string;
};
export type ToolResult = {
  ok: boolean;
  filesCreated: string[];
  dataRead: string[];
  fieldsRead: string[];
  fieldsExcluded: string[];
  externalSideEffect: boolean;
  reversible: boolean;
  evidence: Record<string, unknown>;
  data?: unknown;
  artifactId?: string;
  sent?: boolean;
  externalEffect?: "NONE" | "SIMULATED" | "ACTUAL";
};
export type ToolDefinition = {
  name: string;
  version: string;
  minimumPolicy: PolicyClass;
  externalSideEffect: boolean;
  reversible: boolean;
  execute(args: unknown, ctx: ToolContext): Promise<ToolResult>;
};
