# Reproducible evidence for ActFlow

Prepared October 23, 2026, Asia/Seoul. This evaluation exercises the implemented artifact verifier and workflow engine. It makes no claim about an award, real model quality, customer adoption, or real email delivery.

The [recorded October 23 result](2026-10-23-evidence-results.md) passed 24/24 constructed cases: 8/8 valid artifacts accepted, 0/12 invalid artifacts accepted by goal verification, and 4/4 workflow lifecycle checks passed. The text-only ablation accepted 12/12 invalid candidates. These measurements apply only to the stated fixture set and controls below.

## Run it

From the repository root, after `npm ci`:

```sh
npx tsx scripts/benchmark-evidence.ts
npx vitest run tests/integration/evidence-benchmark.test.ts tests/integration/benchmark-runner.test.ts tests/unit/benchmark.test.ts
```

The first command creates a fresh directory under `data/runtime/evidence-benchmarks/` and prints paths to `report.md` and `report.json`. Use `--output <directory>` to choose a parent directory. It does not load `.env`, select a network provider, consume credits, or send email. Production mode is rejected. Its integration test makes `fetch` throw and verifies it was never called. Each invocation preserves its own candidate files and SQLite databases for inspection; workflow rejection and tamper cases intentionally delete their staged files as the behavior under measurement.

The JSON contains expected fixture inputs, input hashes, candidate file hashes, independent oracle observations, individual verifier predicates, workflow event types, detailed verification records, and observed file presence after recovery. The process returns a failing exit code when a measured case fails. Unexpected infrastructure errors terminate the command and must not be presented as a passing report.

## What the cases establish

The suite has **24 distinct constructed cases, run once each**: 20 artifact cases and four workflow lifecycle cases. These are not 24 independent users or 24 natural-language tasks.

| Set | Cases | What changes |
|---|---:|---|
| Valid artifacts | 8 | Participant count, permitted row order, Unicode/XML-sensitive values, response count and zero cost |
| Invalid artifacts | 12 | Missing header, wrong ID/department, duplicate row, formula, extra sheet, hidden row, private column, wrong response count/cost/recipient/body |
| Workflow lifecycle | 4 | Manual completion, pre-execution completion, rejected approval cleanup, staged-file tampering before approval |

For artifact cases, the production goal verifier is compared with an evaluation oracle that consumes the expected source facts and physically reopens the file. The oracle never reads the production verifier's verdict or predicates. XLSX inspection uses independently written assertions but shares ExcelJS as a parser; this is not parser diversity. The DOCX oracle reads the controlled fixture's OOXML text runs with JSZip, independently of the production mammoth extractor. This deliberately bounded oracle is not a general-purpose OOXML validator.

The **text-only ablation** runs the same production parser against the same candidate bytes with required-text checks but without goal predicates. It shows why finding names or a title is insufficient. It does not measure a competing product or compare model reasoning. “Invalid artifact acceptance” is an artifact-level result; it must not be relabeled as the real-world false task-completion rate.

The four workflow cases run the actual SQLite-backed engine with the bundled deterministic DemoProvider. Successful cases must complete and produce two committed files whose source values and hashes independently match. Rejected and tampered cases must stop, record rollback, and physically remove both staged files. Tampering is documented with before/after hashes and a failed verification event. The simulated email path has no actual external effect.

The older `npm run benchmark -- --provider demo --runs 20` remains a repeated single-fixture timing regression. Its 20 repetitions per mode are not 20 different input scenarios, and it does not measure human task time. The two commands answer different questions.

## Appropriate submission language

Use the measured numbers from the generated report, with this scope attached:

> Our offline evaluation contains 20 constructed artifact cases and four workflow lifecycle cases. We independently reopen files and inspect stored state and cleanup. These results evaluate deterministic verification and recovery behavior. They do not measure live Nemotron quality, actual Gmail delivery, or general user-task success.

Live Nebius/NVIDIA planning and repair receipts, controlled-account Gmail delivery, user observations, and hosted judge access still require separate evidence. No synthetic result should be labeled a live model result.

## Official submission requirements checked October 23

The deadline is October 30, 2026 at 10:00 PDT, which is **October 31 at 02:00 KST**. Judging ends December 15 at 12:00 PST, or **December 16 at 05:00 KST**. Working judge access must remain free through judging. The rules require an actual Nebius runtime path and an NVIDIA open-source model, a working demo/build URL, a public open-source repository with setup instructions, public YouTube demonstration, English materials or translations, and tool feedback. Technology, Design, Potential Impact, and Quality of the Idea have equal weight. Best Apps and Agents is the closest fit for ActFlow's demonstrated workflow; that track choice is our interpretation. [Official rules](https://nebiusglobalaihackathon.devpost.com/rules)

The organizer recommends making Nebius and the NVIDIA model explicit in the description and the video's spoken narration, leading with the problem and showing the working product within three minutes. [Official submission guidance](https://nebiusglobalaihackathon.devpost.com/updates/46205-how-to-build-a-winning-project)
