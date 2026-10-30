# Deploy ActFlow on one persistent server

This package runs one Node.js server with its durable SQLite worker. Keep it running throughout judging. The browser may close; stopping the server pauses polling until restart. Do not deploy this SQLite worker to an ephemeral serverless function or run multiple replicas.

## Docker on a Linux VM

Install Docker Compose, point your domain at the VM, and run these commands from the repository root:

```sh
node scripts/initialize-production-env.mjs https://your-domain.example
docker compose -f deploy/compose.yaml build
docker compose -f deploy/compose.yaml up -d
```

The initializer creates `.env.production.local` once and never overwrites an existing file. Back up its `ACTFLOW_MASTER_KEY` securely. Changing that key makes stored Nebius and Gmail credentials unreadable. No private `.env` file enters the image or review ZIP. If Node is unavailable on the host, run the initializer with a Node 24 container mounting the checkout before building.

Set up host Caddy with [the template](../deploy/Caddyfile.example), replacing the domain. Only Caddy should be public; Compose binds the app to `127.0.0.1:3000`. Allow HTTPS and the HTTP ACME challenge in your VM firewall. Match `ACTFLOW_PUBLIC_URL` exactly to the HTTPS origin. Recreate the app after editing its environment file.

Create a login with a private password input. On Bash:

```sh
read -s -p 'New password (12+ characters): ' ACTFLOW_NEW_USER_PASSWORD
export ACTFLOW_NEW_USER_PASSWORD
docker compose -f deploy/compose.yaml exec -e ACTFLOW_NEW_USER_PASSWORD actflow npm run auth:create-user -- --username owner --role APPROVER
unset ACTFLOW_NEW_USER_PASSWORD
```

Create a separate `judge` account in the same way. By default each account gets its own workspace. To intentionally share a workspace with a collaborator, supply `--workspace ID` printed when creating its owner. `APPROVER` can authorize organizational actions and change instance-wide execution settings; `USER` cannot. Workspace data and connected credentials are scoped separately. Use a dedicated test mailbox and dedicated Nebius key for a judge workspace, and share login access privately through the submission form.

## Gmail

1. Create/select a Google Cloud project; enable the Gmail API.
2. Configure OAuth consent and a **Web application** OAuth client. Add the exact redirect URI `https://your-domain.example/api/connectors/gmail/callback`.
3. Put the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the private production environment. Never put them into browser code or the repository.
4. Restart/recreate ActFlow, log in, and use **Settings → Gmail → Connect**. The app requests `gmail.readonly` and `gmail.send`, with offline access and PKCE. Accept both scopes.
5. When you are ready to authorize real email through the app, set `ACTFLOW_REAL_MAIL_ENABLED=true` and recreate the service. The UI shows when sending is disabled.
6. Import a chosen inbox message. Enable reply watching to poll only Gmail threads already attached to active watched tasks. Imported bodies may be sent to Nebius as task context after the existing secret scan. Gmail tokens are never model context.

For OAuth apps in Testing, add the intended Google users as test users. Google may expire refresh tokens for Testing apps and may require verification for public access to restricted scopes; plan the consent configuration for the judging period. A local successful login does not establish public OAuth approval. See [Google's web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server) and [Google OAuth production readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).

Gmail read access does not authenticate the asserted sender. This adapter conservatively marks sender authentication unconfirmed, so actual replies require confirmation even for remembered contacts. The preview binds the exact recipient, subject, body and generated attachments. After sending, the app checks the SENT message and attachment hashes. That confirms Gmail accepted matching content, not that the recipient read or received it. A disconnected send becomes UNKNOWN; **Check Gmail result again** performs read-only reconciliation and never resends. A missing result remains blocked. Disconnect removes local encrypted tokens; revoke Google-side access separately in your Google account if needed.

Current input supports text/plain mail bodies. HTML-only messages require extracting the relevant text into a supported document. Calendar, signatures, payments and arbitrary filesystem actions are not implemented.

## Nebius and the first real run

Log into the intended workspace, open Settings, save its Nebius Token Factory API key, select an available NVIDIA model and run **Connection test**. The test performs a small billable inference and verifies the model list. The server never falls back to another provider or an offline fixture. A saved key alone does not establish available credits.

Import a test email or sample document. Review the plan, confirm required actions, download the generated files, then explicitly confirm the task's completion conditions. Keep a real inference receipt and actual Gmail readback for submission evidence. These external checks require your account configuration and are not completed by local mock tests.

## Native Node alternative

Use Node 24 LTS, `npm ci`, `npm run build`, and an edited [systemd service template](../deploy/actflow.service.example). Set the same private environment, create an operator account and run one `next start` process behind Caddy. `npm run start` binds loopback. `start.bat` / `start.sh` are development launchers and must not be publicly exposed.

## Health, restart and backup

`GET /api/health` checks the database. Authenticated `GET /api/readiness` reports worker heartbeat and connection configuration without exposing secrets. The worker runs every 30 seconds; long model/API calls can extend a tick. A failed check must not be described as a completed task. Inspect the task's timeline and server logs.

```sh
docker compose -f deploy/compose.yaml logs --tail 100 actflow
docker compose -f deploy/compose.yaml restart actflow
```

The `actflow_data` named volume preserves the database, documents and generated files. Never use `down --volumes` against data you need. Back up both the volume and its matching encryption key. For a native deployment, stop the service, set its environment and run:

```sh
npm run backup -- --service-stopped --output /private/backups/actflow-2026-10-11
```

The backup uses SQLite's backup API, copies artifact data and writes restore instructions; the encryption key stays separate. Choose an empty destination outside the data directory. Restore with the service stopped, then start one instance. A test restore is part of operating the deployment. Do not publish backups or logs containing workspace content.

## Submission handoff

Deploy the configured app, verify from an external browser, record an English video under 3 minutes using real Nebius inference, and supply the public repository/demo/video URLs in Devpost. Account secrets, publishing, final real-mail evidence and provider credits are separate operator steps. Docker build and the public domain/OAuth flow must be checked on the selected host; this Windows workspace has no Docker engine.
