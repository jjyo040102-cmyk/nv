// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dashboard } from "../../components/Dashboard";
import { ExecutionControls } from "../../components/ExecutionControls";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(cleanup);
describe("manual UI boundary", () => {
  it("shows a goal composer and an empty workflow list", () => {
    render(<Dashboard initialTasks={[]} initialWorkflows={[]} initialSettings={{ executionMode: "MANUAL", preExecutionEnabled: false, providerId: "demo", model: "actflow-demo-v1", effort: null, organizationPolicyVersion: 1 }} />);
    expect(screen.getByRole("heading",{name:"무엇을 맡길까요?"})).toBeTruthy();
    expect(screen.getByText(/아직 시작한 작업이 없습니다/)).toBeTruthy();
  });
  it("Analyze invokes only Analyze and announces no work", async () => {
    const analyze = vi.fn(); const execute = vi.fn();
    render(<ExecutionControls status="DRAFT" busy={false} hasTemporary={false} onAnalyze={analyze} onExecute={execute} onPause={vi.fn()} onResume={vi.fn()} onDiscard={vi.fn()} executedActions={0} />);
    await userEvent.click(screen.getByRole("button", { name: /문서 분석/ }));
    expect(analyze).toHaveBeenCalledOnce(); expect(execute).not.toHaveBeenCalled();
    expect(screen.getByText("아직 실행된 작업이 없습니다.")).toBeTruthy();
  });
});
