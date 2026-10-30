import { z } from "zod";
import { normalizeWorkflowAnalysis } from "../workflow/analysis";
import { NEBIUS_BASE_URL } from "./presets";

const RiskScoreSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
const ActionRiskSchema = z.object({
  moneyMovement: RiskScoreSchema, externalTransmission: RiskScoreSchema, sensitiveData: RiskScoreSchema,
  legalEffect: RiskScoreSchema, organizationalAuthority: RiskScoreSchema, userRepresentation: RiskScoreSchema,
  destructiveMutation: RiskScoreSchema, reversibility: RiskScoreSchema
}).strict();
const FactSchema = z.object({
  key: z.string().min(1).max(100), value: z.string().min(1).max(20000), confidence: z.number().min(0).max(1),
  evidence: z.object({ source: z.string().min(1).max(250), quoteOrLocator: z.string().max(500).optional() }).strict().optional()
}).strict();
const TaskSchema = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/),
  title: z.string().min(1).max(200),
  kind: z.enum(["ANALYSIS", "DATA_LOOKUP", "DOCUMENT_GENERATION", "DECISION", "CONFIRMATION", "APPROVAL", "EXTERNAL_ACTION", "HUMAN_ONLY", "COMPLETION"]),
  actionType: z.string().min(3).max(100).regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/),
  dependsOn: z.array(z.string()).max(50),
  condition: z.string().max(500).nullable(),
  expectedOutput: z.string().max(500).nullable(),
  suggestedPolicy: z.enum(["AUTO", "CONFIRM", "APPROVAL", "HUMAN_ONLY"]).optional(),
  risk: ActionRiskSchema
}).strict();
const EdgeSchema = z.object({
  from: z.string(), to: z.string(), condition: z.enum(["always", "approved", "rejected", "confirmed", "declined"])
}).strict();
const ProviderMetadataSchema = z.object({
  executionLocation: z.literal("API").optional(),
  provider: z.enum(["demo", "nebius"]),
  model: z.string().min(1).max(150),
  mode: z.enum(["demo", "real"]),
  effort: z.string().max(50).optional(),
  realModelCalled: z.boolean()
}).strict().superRefine((value, context) => {
  if (value.provider === "demo" && (value.mode !== "demo" || value.realModelCalled)) context.addIssue({ code: "custom", message: "Demo metadata must report no real model call" });
  if (value.provider !== "demo" && (value.mode !== "real" || !value.realModelCalled)) context.addIssue({ code: "custom", message: "Real provider metadata mismatch" });
});

const AnalysisObjectSchema = z.object({
  summary: z.string().min(1).max(3000),
  facts: z.array(FactSchema).max(100),
  tasks: z.array(TaskSchema).min(1).max(50),
  edges: z.array(EdgeSchema).max(200),
  warnings: z.array(z.string().max(1000)).max(50),
  provider: ProviderMetadataSchema,
  emailReply: z.object({
    subject: z.string().trim().min(1).max(500).refine(value => !/[\r\n\0]/.test(value), "Invalid mail subject"),
    body: z.string().trim().min(1).max(20000),
    attachGeneratedArtifacts: z.boolean()
  }).strict().nullable().optional(),
  taskOutcome: z.object({
    status: z.enum(["COMPLETE", "WAIT", "CONTINUE"]),
    reason: z.string().trim().min(1).max(1000),
    evidenceTaskIds: z.array(z.string()).min(1).max(50)
  }).strict().nullable().optional()
}).strict().superRefine((analysis, context) => {
  const ids = new Set(analysis.tasks.map(task => task.id));
  if (ids.size !== analysis.tasks.length) context.addIssue({ code: "custom", message: "Duplicate task id" });
  if (analysis.taskOutcome?.evidenceTaskIds.some(id => !ids.has(id))) context.addIssue({ code: "custom", message: "Outcome references unknown evidence step" });
  if (analysis.emailReply && analysis.tasks.some(task => task.actionType === "external.email.send" || task.actionType === "demo.email.simulate")) {
    context.addIssue({ code: "custom", message: "A reply proposal cannot also send mail in the planning episode" });
  }
  for (const task of analysis.tasks) for (const dependency of task.dependsOn) {
    if (!ids.has(dependency) || dependency === task.id) context.addIssue({ code: "custom", message: "Unknown or self task dependency" });
  }
  for (const edge of analysis.edges) if (!ids.has(edge.from) || !ids.has(edge.to)) context.addIssue({ code: "custom", message: "Edge references unknown task" });
  try { normalizeWorkflowAnalysis(analysis); }
  catch (error) { context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Invalid workflow graph or facts" }); }
});

// Model JSON cannot author network receipts. Only the adapter adds this evidence.
export const AnalysisResultSchema = AnalysisObjectSchema.transform(normalizeWorkflowAnalysis);
const InferenceEvidenceSchema = z.object({
  hostingProvider: z.literal("Nebius"), modelPublisher: z.literal("NVIDIA"), endpoint: z.literal(NEBIUS_BASE_URL),
  receipts: z.array(z.object({
    responseId: z.string().min(1).max(500).refine(value => !/[\r\n\0]/.test(value)),
    model: z.string().regex(/^nvidia\/[A-Za-z0-9][A-Za-z0-9._-]{2,139}$/),
    observedAt: z.iso.datetime(), responseSha256: z.string().regex(/^[a-f0-9]{64}$/),
    promptTokens: z.number().int().nonnegative().optional(), completionTokens: z.number().int().nonnegative().optional()
  }).strict()).min(1).max(2)
}).strict();
const RuntimeProviderMetadataSchema = ProviderMetadataSchema.safeExtend({ inference: InferenceEvidenceSchema.optional() }).superRefine((value, context) => {
  if (value.inference && (value.provider !== "nebius" || value.executionLocation !== "API" || value.inference.receipts.some(receipt => receipt.model !== value.model))) {
    context.addIssue({ code: "custom", message: "Inference evidence must match the adapter model and execution route" });
  }
});
export const RuntimeAnalysisResultSchema = AnalysisObjectSchema.safeExtend({ provider: RuntimeProviderMetadataSchema }).transform(normalizeWorkflowAnalysis);
export type ValidatedAnalysis = z.infer<typeof AnalysisResultSchema>;
