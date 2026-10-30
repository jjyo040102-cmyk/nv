import { demoEmailSimulationTool } from "./demoEmailSimulation";
import { employeeLookupTool } from "./employeeLookup";
import { participantsXlsxTool, responseDocxTool } from "./artifactTools";
import { externalEmailSendTool } from "./externalEmailSend";
import type { ToolContext, ToolDefinition, ToolResult } from "./types";

export class ToolNotAllowedError extends Error {
  constructor(name: string) { super(`Tool is not registered: ${name}`); this.name = "ToolNotAllowedError"; }
}
const tools: Readonly<Record<string, ToolDefinition>> = {
  "employee.lookup": employeeLookupTool,
  "artifact.xlsx.participants": participantsXlsxTool,
  "artifact.docx.response": responseDocxTool,
  "demo.email.simulate": demoEmailSimulationTool,
  "external.email.send": externalEmailSendTool
};
export function getTool(name: string): ToolDefinition {
  const tool = tools[name];
  if (!tool) throw new ToolNotAllowedError(name);
  return tool;
}
export async function executeTool(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
  return getTool(name).execute(args, ctx);
}
