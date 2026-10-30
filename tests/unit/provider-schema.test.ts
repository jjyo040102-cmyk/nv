import { describe, expect, it } from "vitest";
import { AnalysisResultSchema } from "../../lib/providers/schemas";

const valid = {
  summary: "교육 참석 회신", facts: [{ key: "deadline", value: "2026-10-20", confidence: 0.98, evidence: { source: "notice.txt", quoteOrLocator: "1행" } }],
  tasks: [{ id: "lookup", title: "대상 조회", kind: "DATA_LOOKUP", actionType: "employee.lookup", dependsOn: [], condition: null,
    expectedOutput: "참석 대상 직원", suggestedPolicy: "AUTO",
    risk: { moneyMovement: 0, externalTransmission: 0, sensitiveData: 0, legalEffect: 0, organizationalAuthority: 0, userRepresentation: 0, destructiveMutation: 0, reversibility: 5 } }],
  edges: [], warnings: [], provider: { provider: "demo", model: "actflow-demo-v1", mode: "demo", realModelCalled: false }
};
describe("analysis output boundary", () => {
  it("accepts a complete typed workflow", () => { expect(AnalysisResultSchema.parse(valid)).toMatchObject(valid); });
  it.each([
    ["policy", { tasks: [{ ...valid.tasks[0], suggestedPolicy: "BYPASS" }] }],
    ["kind", { tasks: [{ ...valid.tasks[0], kind: "SHELL" }] }],
    ["risk", { tasks: [{ ...valid.tasks[0], risk: { ...valid.tasks[0].risk, moneyMovement: 9 } }] }],
    ["confidence", { facts: [{ ...valid.facts[0], confidence: 1.5 }] }],
    ["dependency", { tasks: [{ ...valid.tasks[0], dependsOn: ["missing"] }] }],
    ["unknown execution directive", { tasks: [{ ...valid.tasks[0], shellCommand: "rm -rf /" }] }],
    ["URL action", { tasks: [{ ...valid.tasks[0], actionType: "https://attacker.example" }] }]
  ])("rejects invalid %s", (_label, patch) => { expect(() => AnalysisResultSchema.parse({ ...valid, ...patch })).toThrow(); });
});
