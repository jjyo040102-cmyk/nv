# ActFlow · Nebius × NVIDIA

**An autonomous work agent you can trust to act.**

ActFlow retains a goal, checks action policy before execution, verifies the result, compensates supported failed file changes, and wakes when new information arrives. A completed tool call is separate from a completed user goal.

`PLAN → POLICY CHECK → EXECUTE → VERIFY → COMMIT / COMPENSATE → WAKE`

## Watch the demonstration

[Watch the 2-minute 57-second English demo](ActFlow_Demo_English_2026-10-30/ActFlow_English_Demo_2m57s.mp4). The walkthrough uses sample data, English narration, and translated on-screen labels; the current application interface and original sample spreadsheet use Korean. The video shows task creation, human approval, generated files, evidence, scheduling, completion, and recovery.

## Start locally

Use Node.js 24 LTS (supported: 22.22.2+, 24.15.0+, or 26+).

```sh
npm ci
node scripts/initialize-local-env.mjs
npm run db:migrate
npm run dev
```

Open [ActFlow](http://127.0.0.1:3000). Windows also has `start.bat`; macOS/Linux has `sh start.sh`. These are private development launchers with a shared demo identity. For an authenticated persistent deployment, follow [Deployment](docs/DEPLOYMENT.md). Production startup rejects demo authentication and test fixtures.

**No local LLM or other AI agent installation is used.** Node, SQLite, OCR/document parsing and file generation run as application services; all live model inference uses NVIDIA models through the fixed official Nebius Token Factory endpoint.

## Connect and use

1. In **Settings → Nebius × NVIDIA**, save the workspace's Nebius Token Factory key. Select an available NVIDIA model and run **Connection test**, which checks the model list and makes a small real inference request. The initial candidate is `nvidia/nemotron-3-super-120b-a12b`; account availability and credits must be checked.
2. Follow [Gmail setup](docs/DEPLOYMENT.md#gmail), then connect the mailbox in Settings. Real sending also requires the operator's `ACTFLOW_REAL_MAIL_ENABLED=true` setting.
3. Enter a goal with its document, or select a Gmail inbox message. Plan and execute registered actions.
4. Review approvals in the same task screen. Mail approval shows the exact recipient, subject, body and generated attachments.
5. Download verified files, inspect completion evidence, and explicitly confirm the original goal. Until then, the task remains open. Add a time to check again or enable watched Gmail replies.

## Implemented boundaries

- **Policy:** backend-owned action classes, exact remembered contact boundaries, state/version-bound approval, secret scanning and owner/project isolation. The Gmail adapter treats sender authentication as unconfirmed, so actual Gmail replies require confirmation.
- **Verification:** XLSX/DOCX reopening, exact source-row and count/cost predicates, literal-cell checks, hashes before/after commit and on download. Gmail sending requires a matching SENT-message readback and attachment hashes. Acceptance by Gmail is not proof of recipient delivery or reading.
- **Completion:** a versioned Goal Contract keeps the original goal, required actions/artifacts/mail and selected extracted facts. Exact source quotations can support facts; unsupported claims remain visible for manual review. Only explicit owner confirmation finishes the goal and disables its triggers.
- **Recovery:** failed supported artifact episodes remove their own unmodified, unshared generated files, including earlier commits in that episode. Modified or externally bound files are preserved with a recovery error. One automatic replan is allowed when safe and enabled. No rollback of delivered email, payment or unrelated work is claimed.
- **Durability:** SQLite events, leases, idempotent outbox, persistent account ownership, encrypted credentials, timer scheduling and a worker that runs without a browser. Uncertain mail is never automatically resent; read-only Gmail reconciliation can confirm it later.
- **Simple UI:** Tasks, Approvals and Settings. Execution details and advanced controls are expandable.

The concrete artifact demo is an administrative training workflow using bundled sample employee data. Calendar operations, real payments, signatures, arbitrary shell commands, general spreadsheet formula evaluation and general-purpose business execution are unsupported. Unknown capabilities stop for human work. TXT/PDF/DOCX/image and limited HWP are supported; Gmail import currently requires a text/plain body.

## Validate

```sh
npm run check
npm run test
npm run build
npm run test:e2e
npm run test:production
npm run benchmark:evidence
npm audit
npm run package:source
```

Unit/integration/E2E tests explicitly use isolated data and labeled fixtures or mocked remote services. `test:production` starts a real production server with temporary accounts, tests authentication, timer processing and restart persistence, and never calls Nebius or Gmail. Tests cannot establish live account credits, OAuth approval or real delivery. The reviewed results are in [the current release report](docs/hackathon/2026-10-23-release.md).

`benchmark:evidence` writes a reproducible offline report with 24 distinct synthetic cases: eight valid artifacts, twelve deliberately invalid artifacts and four workflow lifecycle checks. An independent parser oracle checks expected values; a text-only ablation demonstrates the limits of searching for strings. This measures the supported verifier and runtime, not live model performance or competitor quality. See [method and scope](docs/hackathon/2026-10-23-evidence-benchmark.md).

On the dashboard, **예제 문서로 시작** loads a synthetic notice and an editable goal; **시작** creates a persistent task. Search and state filters help locate work that needs attention. A task's **검증 요약 저장** button exports a content-minimized JSON report with execution provenance, goal conditions and freshly checked file hashes. The checksum is not a digital signature, and test receipts are not live-service proof.

On a fresh test machine, install Chromium with `npx playwright install chromium` before browser tests (`--with-deps` on a Linux test host that needs system libraries). `npm run test:production -- --browser` additionally verifies the real production login/logout screens, protected routes and desktop/mobile layout, and saves screenshots under its isolated evidence directory.

Optional inference benchmark, with `NEBIUS_API_KEY` supplied privately to that CLI process:

```sh
npm run benchmark -- --provider nebius --model nvidia/nemotron-3-super-120b-a12b --real --runs 20
```

Browser inference uses the workspace's saved key, not the CLI environment key. Offline fixtures are never production model choices or hackathon inference evidence.

## Delivery and submission

`npm run package:source` generates `data/runtime/submission/ActFlow-Nebius-NVIDIA-Review-Source.zip`. It contains current application code, tests, deployment templates, documentation and sample data; it excludes keys, databases, private documents, dependencies and old archives. Source is licensed under [MIT](LICENSE); dependencies retain their own licenses.

- [Hackathon requirements and judging analysis](docs/hackathon/2026-10-07-actflow-hackathon-review.md)
- [Reviewer quickstart and evidence guide](docs/hackathon/JUDGE_GUIDE.md)
- [Current release and verification](docs/hackathon/2026-10-23-release.md)
- [Deployment and Gmail instructions](docs/DEPLOYMENT.md)
- [Current demo recording script](docs/COMPETITION_DEMO.md)
- [Submission playbook](docs/hackathon/actflow-submission-playbook.md)
- [Security scope](docs/SECURITY.md)

The project reuses the September 30 workflow baseline and October 3 stabilized Living Tasks, consolidated for Nebius × NVIDIA on October 7. October 11 adds account authentication, Gmail REST integration, goal completion evidence, compensation/replanning, simpler UI and deployment packaging. October 23 adds guided sample onboarding, search and filters, evidence bound to the relevant execution, privacy-minimized evidence export, an offline adversarial evaluation and dependency security updates. Disclose this history accurately. Real account validation and Devpost submission still require the configured external accounts and URLs.
