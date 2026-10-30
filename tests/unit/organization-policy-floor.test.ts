import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "../../lib/policy/engine";
describe("organization policy minimum", () => {
  it("keeps unknown actions human-only even if an added rule proposes CONFIRM", () => {
    const result = evaluatePolicy({ actionType: "unknown.action", amountKrw: 0, sensitiveData: false, reversibility: false, externalSideEffect: false,
      actorRole: "USER", policySet: { version: 1, rules: [{ id: "org.unknown", classification: "CONFIRM", when: { actionPrefix: "unknown." } }] } });
    expect(result.classification).toBe("HUMAN_ONLY");
  });
});
