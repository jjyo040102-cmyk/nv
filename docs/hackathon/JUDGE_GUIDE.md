# ActFlow — reviewer guide

**Work completed with evidence.** ActFlow is an operations agent for preparing a training submission: read a notice, identify sample participants, request expense approval, generate XLSX/DOCX, inspect the actual outputs, and retain the task for its next event.

The product's claim is specific: a successful tool response does not establish that the user's goal is complete. The runtime binds completion evidence to the relevant execution, checks generated files, and preserves the distinction between simulation, recorded model inference, and externally confirmed effects.

## Inspect the implemented product

1. Follow [local setup](../../README.md#start-locally), then connect a Nebius Token Factory key and select an available NVIDIA model in Settings. The regular application does not select a fixture model as a fallback.
2. On the dashboard, choose **예제 문서로 시작** (load sample). It attaches a synthetic training notice and fills an editable goal. Nothing is executed until **시작** (Start).
3. Follow the same persistent task through the required approval, generated files, and completion conditions. The notice uses a November 20, 2026 deadline; its employees and amounts are synthetic.
4. Review **생성된 파일** (generated files) and **완료 조건** (completion conditions). Download the files and inspect their actual contents. A workflow finishing does not automatically finish the user's goal.
5. Choose **검증 요약 저장** (save evidence summary). The JSON contains requirement results, execution provenance, file hashes and fresh integrity checks, without goal text, source text, filenames, email addresses, credentials or raw model output. It is a server-recorded snapshot with a checksum, not a signed or independent attestation. Current file failures remain visible even if historical verification passed.

The ordinary application requires the real provider configuration. The UI is Korean; this guide and the video narration explain the flow in English. Gmail requires OAuth configuration and a dedicated test mailbox; see [deployment](../DEPLOYMENT.md). The current release report explicitly identifies which external integrations were actually tested.

## Reproduce offline verification

Use a supported Node.js version and install the locked dependencies:

```sh
npm ci
npm run test
npm run benchmark:evidence
```

The evidence suite uses isolated data and **zero model calls and zero external sends**. It runs 24 distinct cases once each: 8 valid artifacts, 12 deliberately invalid artifacts, and 4 workflow lifecycle cases. These are not 24 end-to-end customer tasks. The exported JSON records expected inputs, independent parser observations, hashes, verification events, and physical recovery results.

The comparison is a deliberately limited **text-only ablation**: it looks for expected strings in a file. It is not a competitor or an LLM baseline. The independent oracle does not call the production verifier, although some document parsing dependencies are shared. Read [the evaluation method](2026-10-23-evidence-benchmark.md) and [the measured results](2026-10-23-evidence-results.md).

To reproduce browser coverage:

```sh
npx playwright install chromium
npm run test:e2e
```

This starts a separate localhost test server with isolated data. Its model fixtures are explicitly enabled only for testing. Production rejects these fixtures. The new sample flow, search/state filters, approval, verified downloads, evidence export, owner confirmation and 390px layout are exercised in a browser.

## Evidence to check during a live demonstration

| Claim | Inspect | What it does not prove |
|---|---|---|
| NVIDIA inference through Nebius | Server-recorded API model receipt, response hash, token usage when provided | Mocked receipts in automated tests are not live account evidence |
| Correct supported artifacts | Exact participant rows, document count/cost, structure and fresh file hashes | Truth of the source or arbitrary business correctness |
| Recovery | Failed checks, recorded cleanup and absence of supported staged files | Undo of already delivered email or unrelated files |
| Authorized mail | Exact approval and Gmail SENT content/attachment readback | Recipient delivery or reading |
| Persistent task | Same task ID, stored events, restart and idempotence checks | Background availability when the server is off |
| Completed goal | Current execution evidence and explicit owner confirmation | A guarantee that every possible user intent was inferred |

## Submission context

Recommended track: **Best Apps and Agents**. This is a project-fit recommendation, not an official classification or score. The [official rules](https://nebiusglobalaihackathon.devpost.com/rules) require working access, public source with an open-source license, an English or English-translated submission, and a public YouTube demo under three minutes. The deadline is **October 31, 2026 at 02:00 KST** (October 30 at 10:00 PDT). Maintain free judge access through **December 16 at 05:00 KST** (December 15 at noon PST).

The source predates this release; the README discloses its development history. Local test evidence, public deployment, live account validation, user impact measurements and final submission are separate milestones. Do not substitute the offline report for the required live technology demonstration.
