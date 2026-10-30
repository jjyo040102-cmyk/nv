import { NextResponse, type NextRequest } from "next/server";
export function proxy(request: NextRequest) {
  if (process.env.ACTFLOW_DEMO_AUTH !== "false" || ['/login','/privacy'].includes(request.nextUrl.pathname) || request.nextUrl.pathname.startsWith("/api/") || request.cookies.has("actflow_session")) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.url));
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
