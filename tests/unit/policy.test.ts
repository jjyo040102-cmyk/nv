import { describe, expect, it } from "vitest";
import { builtInPolicySet } from "../../lib/policy/defaultPolicies";
import { evaluatePolicy } from "../../lib/policy/engine";

const policySet = builtInPolicySet(1);
function decide(actionType: string, overrides: Record<string, unknown> = {}) {
  return evaluatePolicy({ actionType, amountKrw: 0, sensitiveData: false, reversibility: true, externalSideEffect: false, actorRole: "USER", policySet, ...overrides });
}

describe("deterministic policy", () => {
  it("allows read-only lookup and local document generation automatically", () => {
    expect(decide("employee.lookup").classification).toBe("AUTO");
    expect(decide("artifact.docx.response").classification).toBe("AUTO");
    expect(decide("artifact.xlsx.participants").classification).toBe("AUTO");
  });
  it("requires confirmation for external send even if model suggests AUTO", () => {
    expect(decide("external.email.send", { externalSideEffect: true, suggestedPolicy: "AUTO", verifiedRecipient: false })).toMatchObject({ classification: "CONFIRM", overrideReason: expect.any(String) });
    expect(decide("external.email.send", { externalSideEffect: true, suggestedPolicy: "AUTO" }).classification).toBe("HUMAN_ONLY");
    expect(decide("demo.email.simulate", { suggestedPolicy: "AUTO" }).classification).toBe("CONFIRM");
  });
  it("requires approval for KRW 180,000 and personal export", () => {
    expect(decide("expense.process", { amountKrw: 180_000 }).classification).toBe("APPROVAL");
    expect(decide("personal.export", { sensitiveData: true, externalSideEffect: true }).classification).toBe("APPROVAL");
  });
  it("keeps contract signing, payment, and destructive external delete human-only", () => {
    for (const actionType of ["contract.sign", "payment.execute", "external.delete"]) {
      expect(decide(actionType, { suggestedPolicy: "AUTO", externalSideEffect: true }).classification).toBe("HUMAN_ONLY");
    }
  });
  it("chooses the strictest applicable rule and never lets organization rules weaken it", () => {
    const custom = { ...policySet, rules: [...policySet.rules, { id: "weak-email", classification: "AUTO" as const, when: { actionType: "external.email.send" } }] };
    expect(evaluatePolicy({ actionType: "external.email.send", amountKrw: 180_000, sensitiveData: false, reversibility: false, externalSideEffect: true, actorRole: "USER", policySet: custom }).classification).toBe("APPROVAL");
    expect(decide("employee.lookup", { suggestedPolicy: "APPROVAL" }).classification).toBe("APPROVAL");
  });
  it("blocks unregistered unknown actions as human-only", () => {
    expect(decide("arbitrary.shell.command").classification).toBe("HUMAN_ONLY");
  });
});
