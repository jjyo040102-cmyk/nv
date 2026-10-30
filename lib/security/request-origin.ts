import { AuthorizationError } from "../auth/roles";

/** The public origin is operator configuration, never a forwarded header supplied by a client. */
export function assertSameOrigin(request: Request): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new AuthorizationError("다른 사이트의 요청은 허용되지 않습니다.");
  if (!origin) return; // Non-browser API clients still require a valid authenticated session.
  try {
    const url = new URL(request.url), host = request.headers.get('host');
    const expected = process.env.ACTFLOW_PUBLIC_URL ? new URL(process.env.ACTFLOW_PUBLIC_URL).origin : host ? new URL(`${url.protocol}//${host}`).origin : url.origin;
    if (new URL(origin).origin === expected) return;
  } catch { /* Fail closed for malformed origins. */ }
  throw new AuthorizationError("다른 사이트에서 보낸 변경 요청은 허용되지 않습니다.");
}

export function sessionCookie(token: string, request: Request, remove = false): string {
  const secure = process.env.ACTFLOW_PUBLIC_URL ? new URL(process.env.ACTFLOW_PUBLIC_URL).protocol === "https:" : new URL(request.url).protocol === "https:";
  return `actflow_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${remove ? 0 : 43200}${secure ? "; Secure" : ""}`;
}
export function readSessionCookie(request: Request): string | null {
  const values = request.headers.get("cookie")?.split(";").map(part => part.trim()).filter(part => part.startsWith("actflow_session=")) ?? [];
  return values.length === 1 ? values[0].slice("actflow_session=".length) : null;
}
