const errorKindSymbol = Symbol.for("actflow.domain-error.kind");
const errorKinds = ["API", "WORKFLOW_CONFLICT", "TASK_CONFLICT", "AUTHORIZATION", "DOCUMENT_PARSE", "MODEL_CONFIGURATION", "PROVIDER", "PROVIDER_OUTPUT", "PROVIDER_CONNECTION", "PROVIDER_PRIVACY"] as const;
export type DomainErrorKind = typeof errorKinds[number];

/** Symbol.for preserves server error identity across Next instrumentation/route bundles. */
export class DomainError extends Error {
  constructor(kind: DomainErrorKind, message: string) {
    super(message);
    Object.defineProperty(this, errorKindSymbol, { value: kind });
  }
}

export function getDomainErrorKind(error: unknown): DomainErrorKind | null {
  if (!(error instanceof Error)) return null;
  const kind: unknown = Reflect.get(error, errorKindSymbol);
  return typeof kind === "string" && errorKinds.includes(kind as DomainErrorKind) ? kind as DomainErrorKind : null;
}
