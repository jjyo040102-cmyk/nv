import { unlink } from "node:fs/promises";
export type TestFault = "malformed-provider" | "rollback-delete";
type FaultState = { fault: TestFault; attempts: number };
const scope = globalThis as typeof globalThis & { __actflowTestFaults?: Map<string, FaultState> };
function store(): Map<string, FaultState> { return scope.__actflowTestFaults ??= new Map(); }
export function testFaultsEnabled(): boolean { return process.env.ACTFLOW_TEST_MODE === "true" && process.env.NODE_ENV !== "production"; }
export function setTestFault(workflowId: string, fault: TestFault): void { if (!testFaultsEnabled()) throw new Error("Fault injection is disabled"); store().set(workflowId, { fault, attempts: 0 }); }
export function getTestFault(workflowId: string): TestFault | null { return testFaultsEnabled() ? store().get(workflowId)?.fault ?? null : null; }
export function recordTestAttempt(workflowId: string): void { if (testFaultsEnabled()) { const state = store().get(workflowId); if (state) state.attempts++; } }
export function getTestAttempts(workflowId: string): number { return testFaultsEnabled() ? store().get(workflowId)?.attempts ?? 0 : 0; }
export const testAwareUnlink: typeof unlink = async path => {
  const parts = String(path).split(/[\\/]/); const workflowId = parts.at(-3)!;
  if (getTestFault(workflowId) === "rollback-delete" && String(path).endsWith(".docx")) throw new Error("TEST_DELETE_FAILURE");
  await unlink(path);
};
