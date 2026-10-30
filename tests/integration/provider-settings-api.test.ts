import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as settings, POST as saveSettings } from "../../app/api/settings/route";
import { GET as providers } from "../../app/api/providers/route";
import { POST as testConnection } from "../../app/api/providers/test/route";
import { GET as keys, POST as saveKey, DELETE as deleteKey } from "../../app/api/providers/credentials/route";
import { GET as policies, POST as savePolicy } from "../../app/api/policies/route";
import { POST as switchActor } from "../../app/api/session/actor/route";
import { resetRuntimeForTests } from "../../lib/api/runtime";
import { createDemoSessionCookie } from "../../lib/security/session";

beforeEach(() => { process.env.ACTFLOW_DB_PATH = ":memory:"; process.env.ACTFLOW_DEMO_AUTH = "true"; resetRuntimeForTests(); });
afterEach(() => { resetRuntimeForTests(); delete process.env.ACTFLOW_DB_PATH; process.env.ACTFLOW_DEMO_AUTH = "true"; });
function request(path: string, body?: unknown, role: "USER" | "APPROVER" = "USER", method = "POST") {
  return new Request(`http://localhost${path}`, { method, headers: { "content-type": "application/json", cookie: createDemoSessionCookie(role) }, body: body === undefined ? undefined : JSON.stringify(body) });
}
describe("provider settings and organization routes", () => {
  it("defaults to manual/off, lists exact presets and tests Demo", async () => {
    expect(await (await settings(request("/api/settings", undefined, "USER", "GET"))).json()).toMatchObject({ settings: { executionMode: "MANUAL", preExecutionEnabled: false, providerId: "nebius" } });
    const result = await (await providers(request("/api/providers", undefined, "USER", "GET"))).json();
    expect(result.presets.some((p: { model: string }) => p.model === "nvidia/nemotron-3-super-120b-a12b")).toBe(true);
    expect((await testConnection(request("/api/providers/test", { provider: "demo", model: "actflow-demo-v1" }))).status).toBe(200);
    expect((await saveSettings(request("/api/settings", { providerId: "anthropic", model: "gpt-6-astra" }))).status).toBe(400);
  });
  it("does not allow the high security floor to be lowered through settings", async () => {
    expect((await saveSettings(request("/api/settings", { securityLevel: "STANDARD" }))).status).toBe(400);
    expect((await saveSettings(request("/api/settings", { securityLevel: "CUSTOM" }))).status).toBe(400);
    expect((await saveSettings(request("/api/settings", { securityLevel: "HIGH" }))).status).toBe(200);
  });
  it("never returns raw keys and removes saved credential", async () => {
    const raw = "sk-test-only-api-0123456789";
    expect((await saveKey(request("/api/providers/credentials", { provider: "nebius", apiKey: raw }))).status).toBe(201);
    const response = await keys(request("/api/providers/credentials", undefined, "USER", "GET"));
    const text = await response.text();
    expect(text).not.toContain(raw);
    expect(text).toContain("6789");
    expect((await deleteKey(request("/api/providers/credentials", { provider: "nebius" }, "USER", "DELETE"))).status).toBe(200);
    const body = await (await keys(request("/api/providers/credentials", undefined, "USER", "GET"))).json();
    expect(body.credentials.find((c: { provider: string }) => c.provider === "nebius").saved).toBe(false);
  });
  it("permits only version-matched tightening by an approver", async () => {
    const input = { expectedVersion: 1, name: "엄격한 조직", rules: [{ id: "org.lookup", classification: "APPROVAL", when: { actionType: "employee.lookup" } }] };
    expect((await savePolicy(request("/api/policies", input))).status).toBe(403);
    expect((await savePolicy(request("/api/policies", input, "APPROVER"))).status).toBe(200);
    expect((await savePolicy(request("/api/policies", input, "APPROVER"))).status).toBe(409);
    const weak = { ...input, expectedVersion: 2, rules: [{ id: "org.weak", classification: "AUTO", when: { actionType: "payment.execute" } }] };
    expect((await savePolicy(request("/api/policies", weak, "APPROVER"))).status).toBe(400);
    expect((await (await policies(request("/api/policies", undefined, "USER", "GET"))).json()).version).toBe(2);
  });
  it("disables demo role switching when demo auth is off", async () => {
    const req = request("/api/session/actor", { role: "APPROVER" });
    process.env.ACTFLOW_DEMO_AUTH = "false";
    expect((await switchActor(req)).status).toBe(401);
  });
});
