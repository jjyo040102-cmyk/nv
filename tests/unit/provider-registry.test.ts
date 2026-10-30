import { describe, expect, it } from "vitest";
import { createProvider, createWorkflowAnalyzer } from "../../lib/providers/registry";

describe("hackathon provider construction", () => {
  it("requires a Nebius credential and preserves the selected NVIDIA model", () => {
    expect(() => createProvider({ provider: "nebius", model: "nvidia/nemotron-3-super-120b-a12b" })).toThrow();
    const provider = createProvider({ provider: "nebius", model: "nvidia/nemotron-3-super-120b-a12b", apiKey: "synthetic-test-key" });
    expect(provider.id).toBe("nebius");
    expect(provider.model).toBe("nvidia/nemotron-3-super-120b-a12b");
  });
  it("keeps explicit offline fixtures labeled as fixtures with no real model call", async () => {
    const result = await createWorkflowAnalyzer(createProvider({ provider: "demo", model: "actflow-demo-v1" }))({ workflowId: "wf", sourceText: "unknown", sourceName: "x.txt" });
    expect(result.provider).toMatchObject({ mode: "demo", realModelCalled: false });
    expect(result.tasks[0].kind).toBe("HUMAN_ONLY");
  });
});
