import { describe, expect, it } from "vitest";
import { resolveProviderProfile } from "../../lib/providers/presets";

describe("NVIDIA model selection", () => {
  it("accepts exact NVIDIA names without silently substituting a model", () => {
    expect(resolveProviderProfile("nebius", "nvidia/nemotron-3-super-120b-a12b")).toMatchObject({ provider: "nebius", model: "nvidia/nemotron-3-super-120b-a12b", apiEffort: null });
    expect(resolveProviderProfile("nebius", "nvidia/Nemotron-3_5-Lightning")).toMatchObject({ model: "nvidia/Nemotron-3_5-Lightning" });
  });
  it("blocks other publishers, arbitrary routes, and unsupported reasoning parameters", () => {
    for (const model of ["gpt-6-astra", "Qwen/Qwen3.8-Flash-Next", "deepseek-ai/DeepSeek-R1", "nvidia/../../other", "nvidia/"]) expect(() => resolveProviderProfile("nebius", model)).toThrow();
    expect(() => resolveProviderProfile("nebius", "nvidia/nemotron-3-super-120b-a12b", "xhigh")).toThrow();
  });
});
