import { z } from "zod";
import { ApiError } from "./responses";
import { fixtureModelEnabled } from "../providers/presets";

const InferenceProviderSchema = z.enum(["nebius", "demo"]).refine(provider => provider !== "demo" || fixtureModelEnabled(), "Sample inference is available only in development test mode");

export const WorkflowIdSchema = z.uuid();
export const AnalyzeRequestSchema = z.object({
  executionMode: z.enum(["MANUAL", "PRE_EXECUTION"]).optional(),
  preExecutionEnabled: z.boolean().optional()
}).strict();
export const ProviderSelectionSchema = z.object({ provider: InferenceProviderSchema, model: z.string().min(3).max(150), effort: z.string().max(30).optional() }).strict();
export const SettingsRequestSchema = z.object({
  executionMode: z.enum(["MANUAL", "PRE_EXECUTION"]).optional(), preExecutionEnabled: z.boolean().optional(),
  providerId: InferenceProviderSchema.optional(), model: z.string().min(3).max(150).optional(),
  effort: z.string().max(30).nullable().optional(),
  automationProfile: z.enum(["SAFE", "AUTOMATIC", "CUSTOM"]).optional(),
  autoContinueEnabled: z.boolean().optional(),
  projectMemoryEnabled: z.boolean().optional(),
  emailTaskDetectionEnabled: z.boolean().optional(),
  autoLinkWorkEnabled: z.boolean().optional(),
  replanOnNewInfoEnabled: z.boolean().optional(),
  retryFailedStepsEnabled: z.boolean().optional(),
  securityLevel: z.enum(["HIGH", "STANDARD", "CUSTOM"]).optional()
}).strict();
export async function readJson(request: Request): Promise<unknown> {
  const limit = 1024 * 1024;
  if (Number(request.headers.get('content-length')) > limit) throw new ApiError(413, "요청이 너무 큽니다.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "요청 JSON을 읽을 수 없습니다.");
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new ApiError(413,"요청이 너무 큽니다."); }
      parts.push(part.value);
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, "요청 JSON을 읽을 수 없습니다."); }
  finally { reader.releaseLock(); }
}
