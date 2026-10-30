# Competition demo — 2:55 English recording plan

October 23 review update: the dashboard now loads the sample into an editable goal and creates a persistent task only after Start. The sample deadline is November 20, 2026. A task can export a content-minimized JSON evidence summary with fresh committed-file hash checks. The [reviewer guide](hackathon/JUDGE_GUIDE.md) and [offline evaluation results](hackathon/2026-10-23-evidence-results.md) support recording preparation; the evaluation uses zero model calls and cannot replace real Nebius/Gmail footage.

Record this after a real NVIDIA model connection and Gmail OAuth have been verified. Use a dedicated test mailbox and synthetic business data. Keep the UI readable; English narration/captions explain the Korean UI. This script is recording preparation, not evidence that the external services already passed.

| Time | Show | English narration |
|---|---|---|
| 0:00–0:18 | One task and its goal | “An agent can claim a task is done even when only some steps succeeded. ActFlow separates the plan, the action, and the evidence that the goal was met.” |
| 0:18–0:38 | Nebius × NVIDIA connection and real planning receipt | “NVIDIA's model on Nebius Token Factory turns this notice into a plan. ActFlow owns the action boundaries. Model text cannot grant permission.” |
| 0:38–1:10 | Exact recipient and approval preview | “This address differs by one character. It stops for confirmation. Here are the exact recipient, message and attachments before anything leaves the workspace.” |
| 1:10–1:35 | Verified XLSX/DOCX, file download, predicates | “A successful API response is not enough. We reopen the files, compare the expected fields and source values, and check their hashes before committing.” |
| 1:35–2:00 | Separately recorded failure test and recovery evidence | “In this deliberately injected artifact failure, ActFlow removes its unmodified outputs, including an earlier file from the failed episode, and replans once. Modified or shared files are preserved. Delivered email cannot be undone.” |
| 2:00–2:25 | Gmail SENT readback; a received reply wakes same task | “The mail is checked in Gmail's sent mailbox. If the connection drops, we check the result without resending. A reply wakes the same persistent goal while the server keeps running.” |
| 2:25–2:45 | Original goal, completed checks, manual confirmations | “Execution and completion are separate. Every required result has evidence; unsupported facts remain visible for review. The owner confirms that the original goal is met.” |
| 2:45–2:55 | Clean task overview and product line | “ActFlow: AI that acts, verifies, and recovers—with evidence you can inspect.” |

The injected failure clip must visibly say **Controlled test / synthetic data**; production disables fault injection. Use real model/Gmail evidence for the main workflow, not an edited fixture labeled as live. A Gmail SENT readback is acceptance/content evidence, not proof of recipient delivery. The official dataset lookup is a bundled employee sample. Do not show keys, login passwords, OAuth codes or real private inbox content.

Prepare these evidence items before submission: exact Nebius model ID/receipt, public repository URL with LICENSE and contribution history, public HTTPS demo URL and private judge login, English YouTube URL under 3 minutes, technology feedback and a date-stamped verification report. The [deployment guide](DEPLOYMENT.md) includes the account/connector setup. The [release report](hackathon/2026-10-11-release.md) separates local checks from remaining external validation.
