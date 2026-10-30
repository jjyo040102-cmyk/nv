import { getRuntime } from "@/lib/api/runtime";
import { AccountService } from "@/lib/auth/accounts";
import { apiFailure, json } from "@/lib/api/responses";
import { assertSameOrigin, readSessionCookie, sessionCookie } from "@/lib/security/request-origin";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const token = readSessionCookie(request);
    if (token) new AccountService(getRuntime().db).logout(token);
    const response = json({ loggedOut: true });
    response.headers.set("set-cookie", sessionCookie("", request, true));
    return response;
  } catch (error) { return apiFailure(error); }
}
