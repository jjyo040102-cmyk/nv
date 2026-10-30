import { describe, expect, it } from "vitest";
import { GET } from "../../app/api/workflows/[id]/events/route";
import { getRuntime, resetRuntimeForTests } from "../../lib/api/runtime";

describe("recorder endpoint", () => {
  it("returns appended sequence order and accepts an after cursor", async () => {
    process.env.ACTFLOW_DB_PATH = ":memory:"; process.env.ACTFLOW_DEMO_AUTH = "true"; resetRuntimeForTests();
    const app = getRuntime();
    const workflow = app.repo.createWorkflow({ sourceName: "x.txt", sourceText: "x" });
    app.db.prepare("INSERT INTO recorder_events(id,workflow_id,event_type,event_json,created_at) VALUES (?,?,?,?,?)").run("one", workflow.id, "ANALYZED", JSON.stringify({ workflowId: workflow.id, eventType: "ANALYZED", actor: "system", externalEffect: "NONE" }), new Date().toISOString());
    const response = await GET(new Request(`http://localhost/api/workflows/${workflow.id}/events?after=0`), { params: Promise.resolve({ id: workflow.id }) });
    const body = await response.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].sequence).toBe(1);
    resetRuntimeForTests(); delete process.env.ACTFLOW_DB_PATH;
  });
});
