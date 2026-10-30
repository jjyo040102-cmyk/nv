import { describe, expect, it } from "vitest";
import { assertApprovalRole, assertRequestActor } from "../../lib/auth/roles";
import { createDemoSessionCookie, resolveSessionActor } from "../../lib/security/session";

describe("session-derived authorization", () => {
  it("derives USER from a signed session and ignores a body role", async () => {
    const cookie = createDemoSessionCookie("USER");
    const request = new Request("http://localhost/api/approvals/a/approve", { headers: { cookie } });
    const actor = await resolveSessionActor(request);
    expect(actor).toMatchObject({ id: "demo-user", role: "USER" });
    expect(() => assertRequestActor(actor, { id: "demo-user", role: "APPROVER" })).toThrow();
    expect(() => assertApprovalRole(actor)).toThrow();
  });
  it("accepts a signed APPROVER identity", async () => {
    const request = new Request("http://localhost/", { headers: { cookie: createDemoSessionCookie("APPROVER") } });
    const actor = await resolveSessionActor(request);
    expect(actor.role).toBe("APPROVER");
    expect(() => assertApprovalRole(actor)).not.toThrow();
  });
  it("rejects a tampered session cookie", async () => {
    const signed = createDemoSessionCookie("USER");
    const cookie = signed.slice(0, -1) + (signed.endsWith("A") ? "B" : "A");
    const request = new Request("http://localhost/", { headers: { cookie } });
    await expect(resolveSessionActor(request)).rejects.toThrow();
  });
});
