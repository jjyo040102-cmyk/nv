import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as providers, POST as selectProvider } from "../../app/api/providers/route";
import { POST as saveCredential } from "../../app/api/providers/credentials/route";
import { POST as analyze } from "../../app/api/workflows/[id]/analyze/route";
import { getRuntime, resetRuntimeForTests } from "../../lib/api/runtime";
import { createDemoSessionCookie } from "../../lib/security/session";
import { DEFAULT_NVIDIA_MODEL } from "../../lib/providers/presets";
import * as transport from "../../lib/providers/safe-http";

const original = { db: process.env.ACTFLOW_DB_PATH, auth: process.env.ACTFLOW_DEMO_AUTH, test: process.env.ACTFLOW_TEST_MODE };
beforeEach(() => {
  process.env.ACTFLOW_DB_PATH = ":memory:";
  process.env.ACTFLOW_DEMO_AUTH = "true";
  process.env.ACTFLOW_TEST_MODE = "false";
  resetRuntimeForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
  resetRuntimeForTests();
  for (const [key, value] of Object.entries({ ACTFLOW_DB_PATH: original.db, ACTFLOW_DEMO_AUTH: original.auth, ACTFLOW_TEST_MODE: original.test })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
function request(path: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", cookie: createDemoSessionCookie("USER") },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

describe("hackathon inference boundary", () => {
  it("offers only NVIDIA models hosted on Nebius and starts on that route", async () => {
    const response = await providers(request("/api/providers"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.selected.providerId).toBe("nebius");
    expect(body.presets.length).toBeGreaterThan(0);
    expect(body.presets.every((preset: { provider: string; model: string }) => preset.provider === "nebius" && preset.model.startsWith("nvidia/"))).toBe(true);
    expect(body.credentials.map((credential: { provider: string }) => credential.provider)).toEqual(["nebius"]);
  });

  for (const [providerId, model] of [["openai", "gpt-6-astra"], ["anthropic", "claude-opus-5-5"], ["gemini", "gemini-3.8-flash"], ["demo", "actflow-demo-v1"]]) {
    it(`rejects the removed ${providerId} route instead of silently selecting another model`, async () => {
      const response = await selectProvider(request("/api/providers", { providerId, model }));
      expect(response.status).toBe(400);
      expect(getRuntime().repo.getSettings().providerId).toBe("nebius");
    });
  }

  it("does not accept credentials for a removed provider", async () => {
    const response = await saveCredential(request("/api/providers/credentials", { provider: "openai", apiKey: "synthetic-retired-provider-key" }));
    expect(response.status).toBe(400);
    expect(getRuntime().db.prepare("SELECT COUNT(*) AS n FROM encrypted_credentials").get()).toEqual({ n: 0 });
  });

  it("a missing Nebius key fails planning without an offline success or executed actions", async () => {
    const app = getRuntime();
    const workflow = app.repo.createWorkflow({ sourceName: "task.txt", sourceText: "Prepare a participant roster." });
    const response = await analyze(request(`/api/workflows/${workflow.id}/analyze`, {}), { params: Promise.resolve({ id: workflow.id }) });
    expect(response.status).toBe(400);
    const saved = app.repo.getWorkflow(workflow.id);
    expect(saved?.analysis).toBeNull();
    expect(app.engine.getSnapshot(workflow.id).nodes).toHaveLength(0);
  });

  it("rejects per-request model overrides before inference or workflow mutation", async () => {
    const app = getRuntime();
    await app.credentials.saveCredential("actflow-local-demo", "nebius", "synthetic-nebius-key");
    const risk = { moneyMovement: 0, externalTransmission: 0, sensitiveData: 0, legalEffect: 0, organizationalAuthority: 0, userRepresentation: 0, destructiveMutation: 0, reversibility: 5 };
    const plan = { summary: "Public plan", facts: [], tasks: [{ id: "done", title: "Finish", kind: "COMPLETION", actionType: "workflow.complete", dependsOn: [], condition: null, expectedOutput: null, risk }], edges: [], warnings: [], provider: { provider: "nebius", model: DEFAULT_NVIDIA_MODEL, mode: "real", realModelCalled: true } };
    const http = vi.spyOn(transport, "requestEndpointJson").mockResolvedValue({ id: "synthetic-override-test", model: DEFAULT_NVIDIA_MODEL, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(plan) } }] });
    for (const body of [{ provider: "nebius" }, { model: DEFAULT_NVIDIA_MODEL }, { effort: "default" }]) {
      const workflow = app.repo.createWorkflow({ sourceName: "notice.txt", sourceText: "Public notice" });
      const response = await analyze(request(`/api/workflows/${workflow.id}/analyze`, body), { params: Promise.resolve({ id: workflow.id }) });
      expect(response.status).toBe(400);
      expect(app.repo.getWorkflow(workflow.id)?.status).toBe("DRAFT");
    }
    expect(http).not.toHaveBeenCalled();
  });
});
