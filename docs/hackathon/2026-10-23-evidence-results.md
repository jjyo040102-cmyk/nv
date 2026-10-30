# ActFlow offline evidence report

Generated: 2026-10-23T10:55:59.814Z

**SYNTHETIC / OFFLINE — 0 model calls; 0 external sends.**

Reproducible command: `npx tsx scripts/benchmark-evidence.ts`

24 distinct fixture cases, one execution each. Passed: **24/24**.

| Measurement | Observed |
|---|---:|
| Valid artifacts accepted | 8/8 |
| Invalid artifacts accepted by goal verifier | 0/12 |
| Invalid artifacts accepted by text-only ablation | 12/12 |
| Workflow lifecycle checks passed | 4/4 |

## Artifact evidence

| Case | Oracle | Goal verifier | Text-only | Result |
|---|---|---|---|---|
| valid-roster-one | valid | accept | accept | PASS |
| valid-roster-two | valid | accept | accept | PASS |
| valid-roster-reordered | valid | accept | accept | PASS |
| valid-roster-unicode | valid | accept | accept | PASS |
| valid-response-standard | valid | accept | accept | PASS |
| valid-response-zero-cost | valid | accept | accept | PASS |
| valid-response-one | valid | accept | accept | PASS |
| valid-response-unicode | valid | accept | accept | PASS |
| invalid-roster-missing-header | invalid | reject | accept | PASS |
| invalid-roster-wrong-id | invalid | reject | accept | PASS |
| invalid-roster-wrong-department | invalid | reject | accept | PASS |
| invalid-roster-duplicate | invalid | reject | accept | PASS |
| invalid-roster-formula | invalid | reject | accept | PASS |
| invalid-roster-extra-sheet | invalid | reject | accept | PASS |
| invalid-roster-hidden-row | invalid | reject | accept | PASS |
| invalid-roster-private-column | invalid | reject | accept | PASS |
| invalid-response-count | invalid | reject | accept | PASS |
| invalid-response-cost | invalid | reject | accept | PASS |
| invalid-response-recipient | invalid | reject | accept | PASS |
| invalid-response-body | invalid | reject | accept | PASS |

## Workflow evidence

| Case | Observed state | Physical artifacts | Result |
|---|---|---|---|
| workflow-manual-complete | COMPLETED | COMMITTED/exists, COMMITTED/exists | PASS |
| workflow-preexecution-complete | COMPLETED | COMMITTED/exists, COMMITTED/exists | PASS |
| workflow-rejected-cleanup | FAILED | DELETED/absent, DELETED/absent | PASS |
| workflow-tampered-cleanup | FAILED | DELETED/absent, DELETED/absent | PASS |

## Interpretation and limits

- 20 deterministic artifact cases and 4 actual workflow-engine lifecycle cases; one run per case, not 24 user tasks.
- Independent assertion logic; XLSX shares ExcelJS with the production parser. DOCX oracle reads OOXML with JSZip instead of mammoth.
- Text-only ablation uses the same candidate bytes without goal predicates; it is not a competitor, model-quality, or general task-completion comparison.
- No Nebius, NVIDIA model, Gmail, user-effort, cost, or real-world success measurements. Durations are local processing only.
- Workflow scenarios use the bundled fixed training fixture solely for regression; they do not prove general request understanding or real delivery.

Each reproduction writes a JSON report alongside its generated Markdown. That JSON retains input hashes, physical artifact hashes, separate oracle observations, failed predicates, workflow event types and per-check outcomes. Zero failures in this small constructed suite is not a general reliability guarantee.

Snapshot of run 1906801e-ac6f-4d9e-88ea-bc6bad462317. Runtime files and databases are excluded from source packaging. See [evaluation method](2026-10-23-evidence-benchmark.md) for reproducibility and limits.

