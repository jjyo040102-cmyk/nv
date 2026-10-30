import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types";

function requireWorkspace(ctx: ToolContext) {
  if (!ctx.workspace) throw new Error("Artifact workspace is required");
  return ctx.workspace;
}
export const participantsXlsxTool: ToolDefinition = {
  name: "artifact.xlsx.participants", version: "1", minimumPolicy: "AUTO", externalSideEffect: false, reversible: true,
  async execute(_args, ctx) {
    const rows = ctx.participantRows;
    if (!rows || rows.length === 0) throw new Error("No selected participants available");
    const { buildParticipantsXlsxBytes } = await import("../artifacts/xlsxGenerator");
    const bytes = await buildParticipantsXlsxBytes(rows);
    const artifact = await requireWorkspace(ctx).writeTemporaryArtifact({
      workflowId: ctx.workflowId, displayName: "교육_참석자_명단.xlsx", bytes, createdByNode: ctx.nodeId, preparationKey: ctx.preparationKey
    });
    return { ok: true, artifactId: artifact.id, filesCreated: [artifact.relativePath], dataRead: ["projected employee list"],
      fieldsRead: ["id", "name", "department", "title", "eligibleForTraining"], fieldsExcluded: [],
      externalSideEffect: false, reversible: true, evidence: { rowCount: rows.length, state: "TEMPORARY" } };
  }
};

const ResponseArgs = z.object({
  title: z.string().min(1), recipient: z.string().min(1), body: z.string().min(1),
  participantCount: z.number().int().nonnegative(), expenseKrw: z.number().int().nonnegative()
});
export const responseDocxTool: ToolDefinition = {
  name: "artifact.docx.response", version: "1", minimumPolicy: "AUTO", externalSideEffect: false, reversible: true,
  async execute(args, ctx) {
    const input = ResponseArgs.parse(args);
    const { buildResponseDocxBytes } = await import("../artifacts/docxGenerator");
    const bytes = await buildResponseDocxBytes(input);
    const artifact = await requireWorkspace(ctx).writeTemporaryArtifact({
      workflowId: ctx.workflowId, displayName: "교육_참석_회신.docx", bytes, createdByNode: ctx.nodeId, preparationKey: ctx.preparationKey
    });
    return { ok: true, artifactId: artifact.id, filesCreated: [artifact.relativePath], dataRead: ["workflow facts"],
      fieldsRead: ["title", "recipient", "body", "participantCount", "expenseKrw"], fieldsExcluded: [],
      externalSideEffect: false, reversible: true, evidence: { state: "TEMPORARY", recipient: input.recipient } };
  }
};
