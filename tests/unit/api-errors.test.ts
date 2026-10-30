import { describe, expect, it, vi } from "vitest";
import { apiFailure } from "../../lib/api/responses";
import { WorkflowConflictError } from "../../lib/workflow/engine";

describe("errors crossing Next runtime bundles", () => {
  it("preserves safe domain errors from independent module instances", async () => {
    vi.resetModules();
    const workflow = await import("../../lib/workflow/engine");
    const lease = await import("../../lib/tasks/lease");
    const providers = await import("../../lib/providers/errors");
    const models = await import("../../lib/providers/model-settings");
    const roles = await import("../../lib/auth/roles");
    const documents = await import("../../lib/documents/types");
    const responses = await import("../../lib/api/responses");
    const conflict = new workflow.WorkflowConflictError("Synthetic state conflict");
    expect(conflict).not.toBeInstanceOf(WorkflowConflictError);
    const cases: Array<[Error, number]> = [
      [conflict, 409], [new lease.TaskConflictError("Synthetic lease conflict"), 409],
      [new providers.ProviderOutputError("nebius"), 502], [new providers.ProviderConnectionError("nebius"), 502],
      [new providers.ProviderPrivacyError(), 403], [new models.ModelConfigurationError("Synthetic configuration error"), 400],
      [new roles.AuthorizationError(), 403], [new documents.DocumentParseError("txt", "test.txt", false, "Synthetic parse error"), 400],
      [new responses.ApiError(413, "Synthetic upload limit"), 413]
    ];
    for (const [error, status] of cases) {
      const response = apiFailure(error);
      expect(response.status, error.name).toBe(status);
      expect((await response.json()).error.message).toBe(error.message);
    }
  });

  it("keeps unknown or name-only lookalike errors private", async () => {
    const lookalike = new Error("Synthetic private implementation detail");
    lookalike.name = "WorkflowConflictError";
    for (const error of [lookalike, { name: "ApiError", status: 403, message: "Spoofed request data" }]) {
      const response = apiFailure(error);
      expect(response.status).toBe(500);
      expect((await response.json()).error.message).toBe("요청을 처리하지 못했습니다.");
    }
  });
});
