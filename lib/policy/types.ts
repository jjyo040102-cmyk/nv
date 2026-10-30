import type { PolicyClass, SessionActor } from "../domain/types";

export type PolicyRule = {
  id: string;
  classification: PolicyClass;
  when: {
    actionType?: string;
    actionPrefix?: string;
    amountAtLeast?: number;
    sensitiveExport?: boolean;
    externalSideEffect?: boolean;
    verifiedRecipient?: boolean;
    bulkExport?: boolean;
    secretDetected?: boolean;
    crossScopeData?: boolean;
  };
};
export type PolicySet = { version: number; rules: PolicyRule[] };
export type PolicyInput = {
  actionType: string;
  amountKrw: number;
  sensitiveData: boolean;
  reversibility: boolean;
  externalSideEffect: boolean;
  suggestedPolicy?: PolicyClass;
  actorRole: SessionActor["role"];
  policySet: PolicySet;
  verifiedRecipient?: boolean;
  bulkExport?: boolean;
  secretDetected?: boolean;
  crossScopeData?: boolean;
};
export type PolicyDecision = {
  classification: PolicyClass;
  matchedRules: string[];
  policyVersion: number;
  modelSuggestion: PolicyClass | null;
  overrideReason: string | null;
};
