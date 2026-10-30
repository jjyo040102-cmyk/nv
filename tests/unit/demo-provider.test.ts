import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DemoProvider } from "../../lib/providers/demo";

const official = readFileSync("data/demo/training-notice.txt", "utf8");
describe("deterministic Demo provider", () => {
  it("returns the official training workflow only for the exact fixture", async () => {
    const provider = new DemoProvider();
    const result = await provider.analyzeDocument({ text: official, sourceName: "training-notice.txt" });
    expect(result.provider).toEqual({ provider: "demo", model: "actflow-demo-v1", mode: "demo", realModelCalled: false });
    expect(result.facts).toEqual(expect.arrayContaining([expect.objectContaining({ key: "deadline", value: "2026-11-20" }), expect.objectContaining({ key: "expenseKrw", value: "180000" })]));
    expect(result.tasks.map(task => task.actionType)).toEqual(["employee.lookup", "expense.process", "artifact.xlsx.participants", "artifact.docx.response", "demo.email.simulate", "workflow.complete"]);
    expect(result.edges).toHaveLength(6);
  });
  it("sends arbitrary documents to HUMAN_ONLY review without invented facts", async () => {
    const result = await new DemoProvider().analyzeDocument({ text: "다른 계약서입니다.", sourceName: "unknown.txt" });
    expect(result.facts).toEqual([]);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({ kind: "HUMAN_ONLY", suggestedPolicy: "HUMAN_ONLY" });
    expect(result.warnings.join(" ")).toContain("실제 LLM");
  });
});
