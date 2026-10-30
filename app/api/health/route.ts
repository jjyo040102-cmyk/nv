import { getRuntime } from "@/lib/api/runtime";
export const runtime = "nodejs", dynamic = "force-dynamic";
export async function GET() {
  try { const app = getRuntime(); app.db.prepare("SELECT 1").get(); return Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } }); }
  catch { return Response.json({ status: "unavailable" }, { status: 503 }); }
}
