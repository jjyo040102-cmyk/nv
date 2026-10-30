import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { DemoProvider } from "../../lib/providers/demo";
import { NebiusProvider } from "../../lib/providers/nebius";
import { createRoutedProvider } from "../../lib/providers/router";
import { CredentialStore } from "../../lib/providers/credentials";
import { runMigrations } from "../../lib/db/migrate";
import * as transport from "../../lib/providers/safe-http";

const model = "nvidia/nemotron-3-super-120b-a12b";
const fixture = await new DemoProvider().analyzeDocument({ text: readFileSync("data/demo/training-notice.txt", "utf8"), sourceName: "notice.txt" });
const analysis = { ...fixture, provider: { provider: "nebius", model, mode: "real", effort: "default", realModelCalled: true } };
const response = (content: string, responseModel = model) => ({ id: "completion-synthetic-test", model: responseModel, choices: [{ finish_reason: "stop", message: { role: "assistant", content } }], usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 } });
beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("Nebius inference protocol", () => {
  it("uses the official endpoint and records server supplied NVIDIA inference evidence", async () => {
    const http = vi.spyOn(transport, "requestEndpointJson").mockResolvedValue(response(JSON.stringify(analysis)));
    const result = await new NebiusProvider(model, "synthetic-nebius-key").analyzeDocument({ text: "Public notice", sourceName: "notice.txt" });
    expect(http).toHaveBeenCalledWith("https://api.tokenfactory.nebius.com/v1", "chat/completions", "synthetic-nebius-key", expect.objectContaining({ model, response_format: { type: "json_object" } }));
    expect(result.provider).toMatchObject({ provider: "nebius", executionLocation: "API", realModelCalled: true, inference: { hostingProvider: "Nebius", modelPublisher: "NVIDIA", receipts: [{ responseId: "completion-synthetic-test", model, promptTokens: 20, completionTokens: 30 }] } });
    expect(result.provider.inference?.receipts[0].responseSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("does not call inference when the chosen model is absent from the account model list", async () => {
    const http = vi.spyOn(transport, "requestEndpointJson").mockResolvedValue({ data: [{ id: "another-publisher/model" }] });
    await expect(new NebiusProvider(model, "synthetic-nebius-key").testConnection()).rejects.toThrow("모델 목록");
    expect(http).toHaveBeenCalledTimes(1);
  });
  it("repairs JSON once with the same NVIDIA model and retains both response receipts", async () => {
    const http = vi.spyOn(transport, "requestEndpointJson").mockResolvedValueOnce(response("invalid JSON")).mockResolvedValueOnce(response(JSON.stringify(analysis)));
    const result = await new NebiusProvider(model, "synthetic-nebius-key").analyzeDocument({ text: "Public notice", sourceName: "notice.txt" });
    expect(http).toHaveBeenCalledTimes(2);
    expect(result.provider.inference?.receipts).toHaveLength(2);
  });
  it("rejects an unexpected response model without switching to a fixture", async () => {
    vi.spyOn(transport, "requestEndpointJson").mockResolvedValue(response(JSON.stringify(analysis), "another-publisher/model"));
    await expect(new NebiusProvider(model, "synthetic-nebius-key").analyzeDocument({ text: "Public notice", sourceName: "notice.txt" })).rejects.toMatchObject({ provider: "nebius", code: "INVALID_OUTPUT" });
  });
  it("blocks secrets before any Nebius network request", async () => {
    const db = new Database(":memory:");
    try {
      runMigrations(db);
      const credentials = new CredentialStore(db);
      await credentials.saveCredential("owner", "nebius", "synthetic-nebius-key");
      const http = vi.spyOn(transport, "requestEndpointJson");
      await expect(createRoutedProvider({ db, credentials, ownerSessionId: "owner" }).analyzeDocument({ text: "PASSWORD=synthetic-secret-123456", sourceName: "private.txt" })).rejects.toMatchObject({ code: "PRIVACY_BLOCKED" });
      expect(http).not.toHaveBeenCalled();
    } finally { db.close(); }
  });
  it.each([
    { text: "Public notice", sourceName: "PASSWORD=synthetic-secret-123456.txt" },
    { text: "Public notice", sourceName: "notice.txt", locale: "PASSWORD=synthetic-secret-123456" },
    { text: JSON.stringify({ schemaVersion: "actflow-task-context-v1", sourceDocuments: [{ name: "private.json", text: '{"password":"synthetic-secret-123456"}' }] }), sourceName: "task.txt" }
  ])("blocks secret-bearing prompt fields before the adapter opens a connection: $sourceName", async request => {
    const http = vi.spyOn(transport, "requestEndpointJson").mockResolvedValue(response(JSON.stringify(analysis)));
    await expect(new NebiusProvider(model, "synthetic-nebius-key").analyzeDocument(request)).rejects.toMatchObject({ code: "PRIVACY_BLOCKED" });
    expect(http).not.toHaveBeenCalled();
  });
  it("rejects local, arbitrary, and credential bearing endpoints before opening a connection", async () => {
    for (const url of ["http://127.0.0.1:5000/v1", "https://api.openai.com/v1", "https://api.tokenfactory.nebius.com.evil.test/v1", "https://user:pass@api.tokenfactory.nebius.com/v1", "https://api.tokenfactory.nebius.com/v1?key=secret"]) {
      await expect(transport.requestEndpointJson(url, "models", "synthetic-nebius-key")).rejects.toThrow();
    }
  });
});
