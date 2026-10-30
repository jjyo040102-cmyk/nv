import type { PolicySet } from "./types";

export function builtInPolicySet(version: number): PolicySet {
  return { version, rules: [
    { id: "builtin.internal-lookup", classification: "AUTO", when: { actionType: "employee.lookup" } },
    { id: "builtin.local-xlsx", classification: "AUTO", when: { actionType: "artifact.xlsx.participants" } },
    { id: "builtin.local-docx", classification: "AUTO", when: { actionType: "artifact.docx.response" } },
    { id: "builtin.expense-review", classification: "AUTO", when: { actionType: "expense.process" } },
    { id: "builtin.demo-send-confirm", classification: "CONFIRM", when: { actionType: "demo.email.simulate" } },
    { id: "builtin.external-email-auto", classification: "AUTO", when: { actionType: "external.email.send", verifiedRecipient: true } },
    { id: "builtin.external-email-confirm", classification: "CONFIRM", when: { actionType: "external.email.send", verifiedRecipient: false } },
    { id: "builtin.external-submit-confirm", classification: "CONFIRM", when: { actionType: "external.submit" } },
    { id: "builtin.expense-threshold", classification: "APPROVAL", when: { amountAtLeast: 100_000 } },
    { id: "builtin.personal-export", classification: "APPROVAL", when: { sensitiveExport: true } },
    { id: "builtin.contract-sign", classification: "HUMAN_ONLY", when: { actionType: "contract.sign" } },
    { id: "builtin.payment", classification: "HUMAN_ONLY", when: { actionType: "payment.execute" } },
    { id: "builtin.destructive-external-delete", classification: "HUMAN_ONLY", when: { actionType: "external.delete" } },
    { id: "builtin.secret-export", classification: "HUMAN_ONLY", when: { secretDetected: true } },
    { id: "builtin.cross-scope-export", classification: "HUMAN_ONLY", when: { crossScopeData: true } },
    { id: "builtin.bulk-export", classification: "APPROVAL", when: { bulkExport: true } },
    { id: "builtin.unverified-recipient", classification: "CONFIRM", when: { verifiedRecipient: false, externalSideEffect: true } }
  ] };
}
