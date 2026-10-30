// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkflowGraph } from "../../components/WorkflowGraph";
import { DemoProvider, OFFICIAL_DEMO_TEXT } from "../../lib/providers/demo";
import { buildWorkflowGraph } from "../../lib/workflow/builder";
import { builtInPolicySet } from "../../lib/policy/defaultPolicies";
afterEach(cleanup);
it("fits the whole graph to the actual viewport width", async () => {
  const analysis = await new DemoProvider().analyzeDocument({ text: OFFICIAL_DEMO_TEXT, sourceName: "notice.txt" });
  const graph = buildWorkflowGraph(analysis, builtInPolicySet(1));
  const { container } = render(<WorkflowGraph nodes={graph.nodes} edges={graph.edges} selected={null} onSelect={() => {}} />);
  Object.defineProperty(container.querySelector(".graph-viewport"), "clientWidth", { value: 500 });
  await userEvent.click(screen.getByRole("button", { name: "그래프 맞춤" }));
  expect(parseFloat((container.querySelector(".graph-canvas") as HTMLElement).style.width)).toBeLessThanOrEqual(500);
});
