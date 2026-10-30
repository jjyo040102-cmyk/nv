import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getRuntime } from "@/lib/api/runtime";
import { ApiError, apiFailure, json } from "@/lib/api/responses";
import { readJson } from "@/lib/api/schemas";
import { assertApprovalRole } from "@/lib/auth/roles";
import { builtInPolicySet } from "@/lib/policy/defaultPolicies";
import { resolveSessionActor } from "@/lib/security/session";
const PolicySchema = z.object({ expectedVersion: z.number().int().positive(), name: z.string().min(1).max(100),
  rules: z.array(z.object({ id: z.string().regex(/^org\.[a-zA-Z0-9._-]+$/), classification: z.enum(["CONFIRM", "APPROVAL", "HUMAN_ONLY"]),
    when: z.object({ actionType: z.string().max(100).optional(), actionPrefix: z.string().max(100).optional(),
      amountAtLeast: z.number().nonnegative().optional(), sensitiveExport: z.boolean().optional(), externalSideEffect: z.boolean().optional() }).strict()
  }).strict()).max(50) }).strict();
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    await resolveSessionActor(request); const app = getRuntime(); const version = app.repo.getSettings().organizationPolicyVersion;
    const row = app.db.prepare("SELECT name,policy_json FROM organization_profiles WHERE active=1 ORDER BY version DESC LIMIT 1").get() as { name: string; policy_json: string } | undefined;
    return json({ version, builtIns: builtInPolicySet(version).rules, organization: row ? { name: row.name, ...JSON.parse(row.policy_json) } : { name: "기본 조직 정책", rules: [] } });
  } catch (error) { return apiFailure(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await resolveSessionActor(request); assertApprovalRole(actor);
    const input = PolicySchema.parse(await readJson(request)); const app = getRuntime();
    if (new Set(input.rules.map(rule => rule.id)).size !== input.rules.length) throw new ApiError(400, "정책 ID가 중복되었습니다.");
    const version = app.db.transaction(() => {
      const current = app.repo.getSettings().organizationPolicyVersion;
      if (current !== input.expectedVersion) throw new ApiError(409, "정책 버전이 변경되었습니다.");
      app.db.prepare("UPDATE organization_profiles SET active=0").run();
      app.db.prepare("INSERT INTO organization_profiles(id,name,version,policy_json,active,created_at) VALUES (?,?,?,?,1,?)")
        .run(randomUUID(), input.name, current + 1, JSON.stringify({ rules: input.rules }), new Date().toISOString());
      app.repo.updateSettings({ organizationPolicyVersion: current + 1 });
      return current + 1;
    })();
    return json({ version, organization: { name: input.name, rules: input.rules } });
  } catch (error) { return apiFailure(error); }
}
