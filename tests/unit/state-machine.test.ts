import { describe, expect, it } from "vitest";
import { InvalidTransitionError, transitionNode, transitionWorkflow } from "../../lib/workflow/state-machine";
import type { NodeStatus, WorkflowStatus } from "../../lib/domain/types";

describe("node state machine", () => {
  const allowed: Array<[NodeStatus, NodeStatus]> = [
    ["PENDING", "READY"],
    ["READY", "RUNNING"], ["READY", "WAITING"], ["READY", "PREPARING"], ["READY", "BLOCKED"],
    ["PREPARING", "WAITING"], ["PREPARING", "COMPLETED"], ["PREPARING", "FAILED"],
    ["RUNNING", "COMPLETED"], ["RUNNING", "FAILED"],
    ["COMPLETED", "VERIFIED"], ["COMPLETED", "FAILED"],
    ["WAITING", "RUNNING"], ["WAITING", "REJECTED"],
    ["REJECTED", "ROLLED_BACK"]
  ];
  const all: NodeStatus[] = ["PENDING", "READY", "PREPARING", "WAITING", "RUNNING", "COMPLETED", "VERIFIED", "REJECTED", "ROLLED_BACK", "FAILED", "BLOCKED"];

  it.each(allowed)("%s → %s is allowed", (from, to) => {
    expect(transitionNode(from, to)).toBe(to);
  });

  it("rejects every unlisted edge, including terminal reruns", () => {
    const approved = new Set(allowed.map(([from, to]) => `${from}:${to}`));
    for (const from of all) for (const to of all) {
      if (!approved.has(`${from}:${to}`)) expect(() => transitionNode(from, to)).toThrow(InvalidTransitionError);
    }
  });

  it("rejects invalid runtime strings", () => {
    expect(() => transitionNode("MADE_UP" as NodeStatus, "READY")).toThrow(InvalidTransitionError);
  });
});

describe("workflow state machine", () => {
  const allowed: Array<[WorkflowStatus, WorkflowStatus]> = [
    ["DRAFT", "ANALYZED"], ["ANALYZED", "RUNNING"], ["ANALYZED", "PAUSED"],
    ["RUNNING", "WAITING"], ["RUNNING", "PAUSED"], ["RUNNING", "COMPLETED"], ["RUNNING", "FAILED"],
    ["WAITING", "RUNNING"], ["WAITING", "PAUSED"], ["WAITING", "FAILED"],
    ["PAUSED", "RUNNING"], ["PAUSED", "WAITING"], ["PAUSED", "FAILED"]
  ];
  const all: WorkflowStatus[] = ["DRAFT", "ANALYZED", "RUNNING", "WAITING", "COMPLETED", "FAILED", "PAUSED"];

  it.each(allowed)("%s → %s is allowed", (from, to) => {
    expect(transitionWorkflow(from, to)).toBe(to);
  });

  it("rejects every unlisted edge", () => {
    const approved = new Set(allowed.map(([from, to]) => `${from}:${to}`));
    for (const from of all) for (const to of all) {
      if (!approved.has(`${from}:${to}`)) expect(() => transitionWorkflow(from, to)).toThrow(InvalidTransitionError);
    }
  });
});
