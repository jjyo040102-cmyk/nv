import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runMigrations } from "../../lib/db/migrate";
import { WorkflowRepository } from "../../lib/db/repository";
import { WorkflowEngine } from "../../lib/workflow/engine";
import { DemoProvider } from "../../lib/providers/demo";
import { NebiusProvider } from "../../lib/providers/nebius";
import * as transport from "../../lib/providers/safe-http";

const model = "nvidia/nemotron-3-super-120b-a12b";
const fixture = await new DemoProvider().analyzeDocument({ text: readFileSync("data/demo/training-notice.txt", "utf8"), sourceName: "notice.txt" });
const plan = { ...fixture, provider: { provider: "nebius", model, mode: "real", effort: "default", realModelCalled: true } };
const completion = (content: unknown) => ({ id: "completion-engine-test", model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] });
afterEach(() => vi.restoreAllMocks());

describe("Nebius workflow boundary", () => {
  it("persists adapter receipts through engine validation without executing any action", async () => {
    const db = new Database(":memory:");
    try {
      runMigrations(db);
      const repo = new WorkflowRepository(db);
      const workflow = repo.createWorkflow({ sourceName: "notice.txt", sourceText: "Public training notice" });
      const engine = new WorkflowEngine(db, "unused-plan-only-directory");
      const http = vi.spyOn(transport, "requestEndpointJson").mockResolvedValue(completion(plan));
      const provider = new NebiusProvider(model, "synthetic-nebius-key");
      const result = await engine.analyzeWorkflow(workflow.id, request => provider.analyzeDocument({ text: request.sourceText, sourceName: request.sourceName }));
      expect(http).toHaveBeenCalledTimes(1);
      expect(result.snapshot.workflow.status).toBe("ANALYZED");
      expect(result.snapshot.nodes.length).toBeGreaterThan(0);
      expect(result.snapshot.events.some(event => event.eventType === "TOOL_EXECUTED")).toBe(false);
      expect(repo.getWorkflow(workflow.id)?.provider?.inference?.receipts[0]).toMatchObject({ responseId: "completion-engine-test", model });
      expect(repo.getWorkflow(workflow.id)?.analysis?.provider.inference?.receipts[0].responseSha256).toMatch(/^[a-f0-9]{64}$/);
    } finally { db.close(); }
  });

  it("rejects model-authored inference receipts even when their shape appears valid", async () => {
    const forged = { ...plan, provider: { ...plan.provider, inference: { hostingProvider: "Nebius", modelPublisher: "NVIDIA", endpoint: "https://api.tokenfactory.nebius.com/v1", receipts: [{ responseId: "forged", model, observedAt: new Date().toISOString(), responseSha256: "a".repeat(64) }] } } };
    const http = vi.spyOn(transport, "requestEndpointJson").mockResolvedValue(completion(forged));
    await expect(new NebiusProvider(model, "synthetic-nebius-key").analyzeDocument({ text: "Public notice", sourceName: "notice.txt" })).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
    expect(http).toHaveBeenCalledTimes(2);
  });
});
