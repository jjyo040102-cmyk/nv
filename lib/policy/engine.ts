import type { PolicyClass } from "../domain/types";
import { builtInPolicySet } from "./defaultPolicies";
import type { PolicyDecision, PolicyInput, PolicyRule } from "./types";

const rank: Record<PolicyClass, number> = { AUTO: 0, CONFIRM: 1, APPROVAL: 2, HUMAN_ONLY: 3 };
function applies(rule: PolicyRule, input: PolicyInput): boolean {
  const when = rule.when;
  if (when.actionType !== undefined && when.actionType !== input.actionType) return false;
  if (when.actionPrefix !== undefined && !input.actionType.startsWith(when.actionPrefix)) return false;
  if (when.amountAtLeast !== undefined && input.amountKrw < when.amountAtLeast) return false;
  if (when.sensitiveExport && !(input.sensitiveData && input.externalSideEffect)) return false;
  if (when.externalSideEffect !== undefined && when.externalSideEffect !== input.externalSideEffect) return false;
  if (when.verifiedRecipient !== undefined && when.verifiedRecipient !== input.verifiedRecipient) return false;
  if (when.bulkExport !== undefined && when.bulkExport !== input.bulkExport) return false;
  if (when.secretDetected !== undefined && when.secretDetected !== input.secretDetected) return false;
  if (when.crossScopeData !== undefined && when.crossScopeData !== input.crossScopeData) return false;
  return true;
}

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const builtIns = builtInPolicySet(input.policySet.version).rules;
  const rules = [...builtIns, ...input.policySet.rules.filter(rule => !rule.id.startsWith("builtin."))];
  const matched = rules.filter(rule => applies(rule, input));
  const builtInMatches = builtIns.filter(rule => applies(rule, input));
  const minimum: PolicyClass = builtInMatches.length ? builtInMatches.reduce<PolicyClass>((strictest, rule) =>
    rank[rule.classification] > rank[strictest] ? rule.classification : strictest, "AUTO") : "HUMAN_ONLY";
  const base = matched.reduce<PolicyClass>((strictest, rule) => rank[rule.classification] > rank[strictest] ? rule.classification : strictest, minimum);
  const suggestion = input.suggestedPolicy ?? null;
  const classification = suggestion && rank[suggestion] > rank[base] ? suggestion : base;
  const overrideReason = suggestion && rank[suggestion] < rank[base]
    ? `모델 제안 ${suggestion}보다 결정적 정책 ${base}가 우선합니다.`
    : suggestion && rank[suggestion] > rank[base]
      ? `모델이 ${base}보다 엄격한 ${suggestion}을 제안했습니다.`
      : null;
  return { classification, matchedRules: matched.length ? matched.map(rule => rule.id) : ["builtin.unknown-human-only"], policyVersion: input.policySet.version, modelSuggestion: suggestion, overrideReason };
}
