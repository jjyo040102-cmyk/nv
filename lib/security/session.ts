import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readConfig } from "../config";
import type { SessionActor } from "../domain/types";
import { AuthorizationError } from "../auth/roles";
import { ApiError } from "../api/responses";
import { assertSameOrigin, readSessionCookie } from "./request-origin";

const cookieName = "actflow_session";
const secret = process.env.ACTFLOW_SESSION_SECRET
  ? Buffer.from(process.env.ACTFLOW_SESSION_SECRET, "utf8")
  : randomBytes(32);

function sign(value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function createDemoSessionCookie(role: SessionActor["role"]): string {
  if (!readConfig(process.env).demoAuth) throw new AuthorizationError("데모 인증이 비활성화되어 있습니다.");
  const payload: SessionActor = { id: role === "APPROVER" ? "demo-approver" : "demo-user", role, sessionId: "actflow-local-demo" };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${cookieName}=${encoded}.${sign(encoded)}`;
}

export async function resolveSessionActor(request: Request): Promise<SessionActor> {
  assertSameOrigin(request);
  const raw = readSessionCookie(request);
  if (!readConfig(process.env).demoAuth) {
    const { AccountService } = await import("../auth/accounts");
    const { getRuntime } = await import("../api/runtime");
    const actor = raw ? new AccountService(getRuntime().db).resolve(raw) : null;
    if (!actor) throw new ApiError(401, "로그인이 필요합니다.");
    return actor;
  }
  if (!raw) return { id: "demo-user", role: "USER", sessionId: "actflow-local-demo" };
  const [encoded, signature, extra] = raw.split(".");
  if (!encoded || !signature || extra !== undefined) throw new AuthorizationError("유효하지 않은 세션입니다.");
  const expected = Buffer.from(sign(encoded));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new AuthorizationError("유효하지 않은 세션입니다.");
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); }
  catch { throw new AuthorizationError("유효하지 않은 세션입니다."); }
  if (!parsed || typeof parsed !== "object") throw new AuthorizationError("유효하지 않은 세션입니다.");
  const actor = parsed as Partial<SessionActor>;
  if (actor.sessionId !== "actflow-local-demo" || !["USER", "APPROVER"].includes(actor.role ?? "") ||
      actor.id !== (actor.role === "APPROVER" ? "demo-approver" : "demo-user")) {
    throw new AuthorizationError("유효하지 않은 세션입니다.");
  }
  return actor as SessionActor;
}
