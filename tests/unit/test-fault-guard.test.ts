import { afterEach, describe, expect, it, vi } from "vitest";
import { getTestFault, setTestFault } from "../../lib/testing/faults";
import { demoEmailSimulationTool } from '../../lib/tools/demoEmailSimulation';
afterEach(() => vi.unstubAllEnvs());
describe("development-only fault injection", () => {
  it('also rejects simulated sending in production',async()=>{
    vi.stubEnv('ACTFLOW_TEST_MODE','true');vi.stubEnv('NODE_ENV','production');
    await expect(demoEmailSimulationTool.execute({recipient:'sample@example.com'},{workflowId:'w',nodeId:'n'})).rejects.toThrow(/development test/);
  });
  it("is unavailable in production even when the test flag is set", () => {
    vi.stubEnv("ACTFLOW_TEST_MODE", "true"); vi.stubEnv("NODE_ENV", "production");
    expect(() => setTestFault("production", "rollback-delete")).toThrow();
    expect(getTestFault("production")).toBeNull();
  });
  it("requires an explicit test environment", () => {
    vi.stubEnv("ACTFLOW_TEST_MODE", "false"); vi.stubEnv("NODE_ENV", "test");
    expect(() => setTestFault("disabled", "malformed-provider")).toThrow();
  });
});
