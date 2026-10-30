import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { openDatabase } from "../../lib/db";
import { runMigrations } from "../../lib/db/migrate";
import { WorkflowRepository } from "../../lib/db/repository";
import { ArtifactWorkspace } from "../../lib/artifacts/workspace";
import { verifyArtifact } from "../../lib/workflow/verifier";
import { executeTool, getTool, ToolNotAllowedError } from "../../lib/tools/registry";

describe("allow-listed tools", () => {
  it("rejects arbitrary tool names without loading code", () => {
    expect(() => getTool("node:child_process.exec")).toThrow(ToolNotAllowedError);
    expect(() => getTool("fetch.https://example.com")).toThrow(ToolNotAllowedError);
  });
  it("projects only approved employee fields and reports excluded fields", async () => {
    const result = await executeTool("employee.lookup", { eligibleOnly: true }, { workflowId: "wf", nodeId: "lookup" });
    expect(result.ok).toBe(true);
    expect(result.fieldsRead).toEqual(["id", "name", "department", "title", "eligibleForTraining"]);
    expect(result.fieldsExcluded).toEqual(["bankAccount", "personalPhone", "residentRegistrationLikeDummy"]);
    expect(result.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: "E001", name: "김민지" })]));
    const serialized = JSON.stringify(result.data);
    expect(serialized).not.toContain("bankAccount");
    expect(serialized).not.toContain("personalPhone");
    expect(serialized).not.toContain("residentRegistrationLikeDummy");
  });
  it("labels demo email as a non-sending simulation behind CONFIRM", async () => {
    expect(getTool("demo.email.simulate")).toMatchObject({ minimumPolicy: "CONFIRM", externalSideEffect: false });
    const result = await executeTool("demo.email.simulate", { recipient: "교육 운영팀" }, { workflowId: "wf", nodeId: "email" });
    expect(result).toMatchObject({ ok: true, sent: false, externalSideEffect: false });
  });
  it("creates real temporary XLSX and DOCX through only registered artifact tools", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "actflow-tools-"));
    const db = openDatabase({ dataDir: root, dbPath: ":memory:", demoAuth: true, maxUploadMb: 25 });
    try {
      runMigrations(db);
      const workflow = new WorkflowRepository(db).createWorkflow({ sourceName: "notice.txt" });
      const workspace = new ArtifactWorkspace(db, root);
      const participantRows = [{ id: "E001", name: "김민지", department: "인사팀", title: "대리", eligibleForTraining: true }];
      const xlsx = await executeTool("artifact.xlsx.participants", {}, { workflowId: workflow.id, nodeId: "xlsx", workspace, participantRows });
      const docx = await executeTool("artifact.docx.response", { title: "교육 회신", recipient: "교육팀", body: "참석합니다.", participantCount: 1, expenseKrw: 180_000 }, { workflowId: workflow.id, nodeId: "docx", workspace });
      expect(xlsx.artifactId).toBeTruthy();
      expect(docx.artifactId).toBeTruthy();
      const xlsxPath = resolve(root, workspace.getArtifact(xlsx.artifactId!)!.relativePath);
      const docxPath = resolve(root, workspace.getArtifact(docx.artifactId!)!.relativePath);
      expect((await verifyArtifact({ path: xlsxPath, kind: "xlsx", requiredTexts: ["김민지"] })).passed).toBe(true);
      expect((await verifyArtifact({ path: docxPath, kind: "docx", requiredTexts: ["참석합니다."] })).passed).toBe(true);
      expect(workspace.getArtifact(xlsx.artifactId!)?.state).toBe("TEMPORARY");
    } finally {
      db.close();
      if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected cleanup target");
      rmSync(root, { recursive: true, force: true });
    }
  });
});
