import { approvalAction } from "@/lib/api/actions";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return approvalAction(request, context, "REJECTED"); }
