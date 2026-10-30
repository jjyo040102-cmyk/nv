import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DemoProvider } from "../../lib/providers/demo";
import { analyzeStructuredText, AnalysisCache } from "../../lib/providers/provider";
import { ProviderOutputError } from "../../lib/providers/errors";

const valid = await new DemoProvider().analyzeDocument({ text: readFileSync("data/demo/training-notice.txt", "utf8"), sourceName: "notice.txt" });
const metadata = { provider: "demo" as const, model: "actflow-demo-v1", mode: "demo" as const, realModelCalled: false };
describe("provider failure boundary", () => {
  it("repairs malformed output once using the same request function", async () => {
    const attempts: boolean[] = [];
    const result = await analyzeStructuredText(metadata, async repair => { attempts.push(repair); return repair ? JSON.stringify(valid) : "{bad json"; });
    expect(result.summary).toBe(valid.summary);
    expect(attempts).toEqual([false, true]);
  });
  it("fails safely after exactly two malformed responses", async () => {
    let calls = 0;
    await expect(analyzeStructuredText(metadata, async () => { calls++; return '{"tasks":[]}'; })).rejects.toBeInstanceOf(ProviderOutputError);
    expect(calls).toBe(2);
  });
  it("keys cache by source, provider, model, and prompt schema", () => {
    const cache = new AnalysisCache();
    const request = { text: "source", sourceName: "x.txt" };
    cache.set("demo", "model-a", request, "schema-v1", valid);
    expect(cache.get("demo", "model-a", request, "schema-v1")).toEqual(valid);
    expect(cache.get("demo", "model-a", { ...request, text: "changed" }, "schema-v1")).toBeNull();
    expect(cache.get("demo", "model-b", request, "schema-v1")).toBeNull();
    expect(cache.get("nebius", "model-a", request, "schema-v1")).toBeNull();
    expect(cache.get("demo", "model-a", request, "schema-v2")).toBeNull();
  });
});
