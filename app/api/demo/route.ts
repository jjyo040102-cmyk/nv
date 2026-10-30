import { OFFICIAL_DEMO_TEXT } from "@/lib/providers/demo";
export async function GET() { return new Response(OFFICIAL_DEMO_TEXT, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } }); }
