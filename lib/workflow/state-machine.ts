import type { NodeStatus, WorkflowStatus } from "../domain/types";

export class InvalidTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Invalid transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export type NodeEvent = NodeStatus;
export type WorkflowEvent = WorkflowStatus;

const nodeTransitions: Readonly<Record<NodeStatus, readonly NodeStatus[]>> = {
  PENDING: ["READY"],
  READY: ["RUNNING", "WAITING", "PREPARING", "BLOCKED"],
  PREPARING: ["WAITING", "COMPLETED", "FAILED"],
  WAITING: ["RUNNING", "REJECTED"],
  RUNNING: ["COMPLETED", "FAILED"],
  COMPLETED: ["VERIFIED", "FAILED"],
  VERIFIED: [],
  REJECTED: ["ROLLED_BACK"],
  ROLLED_BACK: [],
  FAILED: [],
  BLOCKED: []
};

const workflowTransitions: Readonly<Record<WorkflowStatus, readonly WorkflowStatus[]>> = {
  DRAFT: ["ANALYZED"],
  ANALYZED: ["RUNNING", "PAUSED"],
  RUNNING: ["WAITING", "PAUSED", "COMPLETED", "FAILED"],
  WAITING: ["RUNNING", "PAUSED", "FAILED"],
  PAUSED: ["RUNNING", "WAITING", "FAILED"],
  COMPLETED: [],
  FAILED: []
};

export function transitionNode(current: NodeStatus, event: NodeEvent): NodeStatus {
  if (!nodeTransitions[current]?.includes(event)) throw new InvalidTransitionError(current, event);
  return event;
}

export function transitionWorkflow(current: WorkflowStatus, event: WorkflowEvent): WorkflowStatus {
  if (!workflowTransitions[current]?.includes(event)) throw new InvalidTransitionError(current, event);
  return event;
}
