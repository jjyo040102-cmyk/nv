import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { POST } from "../../app/api/workflows/route";
import { getRuntime, resetRuntimeForTests } from "../../lib/api/runtime";

beforeEach(() => { process.env.ACTFLOW_DB_PATH = ":memory:"; process.env.ACTFLOW_DEMO_AUTH = "true"; resetRuntimeForTests(); });
afterEach(() => { resetRuntimeForTests(); delete process.env.ACTFLOW_DB_PATH; delete process.env.ACTFLOW_MAX_UPLOAD_MB; });
function upload(name: string, content: Uint8Array, mime = "text/plain") {
  const form = new FormData(); form.set("file", new File([content as BlobPart], name, { type: mime }));
  return new Request("http://localhost/api/workflows", { method: "POST", body: form });
}
describe("workflow upload route", () => {
  it.each([undefined, "1"])("bounds and cancels chunked multipart including extra fields (Content-Length %s)", async declaredLength => {
    process.env.ACTFLOW_MAX_UPLOAD_MB = "1"; resetRuntimeForTests();
    const boundary = "actflow-review-boundary";
    const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="notice.txt"\r\nContent-Type: text/plain\r\n\r\nvalid small document\r\n--${boundary}\r\nContent-Disposition: form-data; name="extra"\r\n\r\n`);
    let chunksRead = 0, canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunksRead === 0) controller.enqueue(prefix);
        else if (chunksRead <= 100) controller.enqueue(Buffer.alloc(65536, 97));
        else { controller.enqueue(Buffer.from(`\r\n--${boundary}--\r\n`)); controller.close(); }
        chunksRead++;
      },
      cancel() { canceled = true; }
    });
    const headers: Record<string, string> = { "content-type": `multipart/form-data; boundary=${boundary}` };
    if (declaredLength) headers["content-length"] = declaredLength;
    const request = new Request("http://localhost/api/workflows", { method: "POST", headers, body: stream, duplex: "half" } as RequestInit);
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect(canceled).toBe(true); expect(chunksRead).toBeLessThan(100);
    expect(getRuntime().db.prepare("SELECT COUNT(*) AS count FROM workflows").get()).toMatchObject({ count: 0 });
  });
  it("creates one parsed workflow from the official notice", async () => {
    const response = await POST(upload("training-notice.txt", readFileSync("data/demo/training-notice.txt")));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.workflow.status).toBe("DRAFT");
    expect(body.workflow.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.source).toMatchObject({ displayName: "training-notice.txt", parser: "txt" });
    expect(JSON.stringify(body)).not.toContain("source_path");
  });
  it("rejects empty, disguised, path-like and oversized inputs", async () => {
    expect((await POST(upload("empty.txt", new Uint8Array()))).status).toBe(400);
    expect((await POST(upload("x.pdf", Buffer.from("plain text"), "application/pdf"))).status).toBe(400);
    expect((await POST(upload("..／secret.txt", Buffer.from("x")))).status).toBe(400);
    process.env.ACTFLOW_MAX_UPLOAD_MB = "1";
    resetRuntimeForTests();
    expect((await POST(upload("large.txt", Buffer.alloc(1024 * 1024 + 1)))).status).toBe(413);
    delete process.env.ACTFLOW_MAX_UPLOAD_MB;
  });
});
