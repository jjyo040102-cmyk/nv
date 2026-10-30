import { getRuntime } from "@/lib/api/runtime";
import { resolveSessionActor } from "@/lib/security/session";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const destination = new URL("/settings", process.env.ACTFLOW_PUBLIC_URL ?? request.url);
  try {
    const actor = await resolveSessionActor(request), query = new URL(request.url).searchParams;
    await getRuntime().gmail.finish(actor.sessionId, actor.id, query.get("state") ?? "", query.get("code") ?? "");
    destination.searchParams.set("gmail", "connected");
  } catch { destination.searchParams.set("gmail", "failed"); }
  return Response.redirect(destination, 303);
}
