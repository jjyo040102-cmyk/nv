import { z } from "zod";
import { getRuntime } from "@/lib/api/runtime";
import { AccountService } from "@/lib/auth/accounts";
import { apiFailure, ApiError, json } from "@/lib/api/responses";
import { readJson } from "@/lib/api/schemas";
import { assertSameOrigin, sessionCookie } from "@/lib/security/request-origin";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const app = getRuntime();
    if (app.config.demoAuth) throw new ApiError(400, "체험 모드에서는 로그인이 필요하지 않습니다.");
    const input = z.object({ username: z.string().max(101), password: z.string().max(256) }).strict().parse(await readJson(request));
    const result = await new AccountService(app.db).login(input.username, input.password);
    const response = json({ actor: result.actor });
    response.headers.set("set-cookie", sessionCookie(result.token, request));
    return response;
  } catch (error) { return apiFailure(error); }
}
