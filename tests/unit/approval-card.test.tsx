// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApprovalCard } from "../../components/ApprovalCard";
import { buildWorkflowGraph } from "../../lib/workflow/builder";
import { builtInPolicySet } from "../../lib/policy/defaultPolicies";
import { DemoProvider, OFFICIAL_DEMO_TEXT } from "../../lib/providers/demo";
const analysis = await new DemoProvider().analyzeDocument({ text: OFFICIAL_DEMO_TEXT, sourceName: "notice.txt" });
const node = buildWorkflowGraph(analysis, builtInPolicySet(1)).nodes.find(node => node.id === "expense")!;
const approval = { id: "a", workflowId: "w", nodeId: node.id, kind: "APPROVAL" as const, status: "PENDING" as const, version: 0, workflowVersion: 2, policyVersion: 1, resolvedBy: null };
afterEach(cleanup);
describe("deliberate approval", () => {
  it("requires approver role and explicit impact acknowledgment", async () => {
    const onDecision = vi.fn();
    const view = render(<ApprovalCard approval={approval} node={node} facts={analysis.facts} actor={{ id: "demo-user", role: "USER", sessionId: "actflow-local-demo" }} busy={false} onDecision={onDecision} />);
    expect((screen.getByRole("button", { name: "승인하고 계속" }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<ApprovalCard approval={approval} node={node} facts={analysis.facts} actor={{ id: "demo-approver", role: "APPROVER", sessionId: "actflow-local-demo" }} busy={false} onDecision={onDecision} />);
    expect((screen.getByRole("button", { name: "승인하고 계속" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/180,000/)).toBeTruthy();
    await userEvent.click(screen.getByRole("checkbox"));
    screen.getByRole("button", { name: "승인하고 계속" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(onDecision).toHaveBeenCalledWith(approval, "APPROVED");
  });
});
