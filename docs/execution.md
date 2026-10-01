# Subscription coding tasks and MCP

The usage API remains compatible. Execution is an additional authenticated service: a durable PostgreSQL queue, staged planner, per-account workers, and a Streamable HTTP MCP endpoint at `/mcp`. The service never stores provider credentials. Provider login code belongs under `collector/src/providers/<provider>`.

## Prepared personal accounts

`config/worker.personal.example.json` registers Codex personal (`codex-personal`), Claude personal (`claude-personal-main`), and Cursor personal (`cursor-personal`). The `-main` suffix separates the real Claude account from the original mock seed. Mock accounts have no execution targets and cannot run tasks. Registration does not claim successful sign-in or available subscription billing.

Install the pinned Linux clients with `ai-builder-tools/cloud/install-clis.sh`. Configure repository paths and persistent account/artifact directories in a private worker JSON file. Never put tokens or OAuth material in it. The provided configuration uses the current cloud checkouts and clones each local task into its own directory; it does not create Git worktrees or modify the source checkout. Only committed source is cloned. Provider-cloud execution operates on the provider's configured repository/branch, not local uncommitted files.

Migrate with `DATABASE_URL=... pnpm db:migrate`. Start the web service. Provide independent, at least 32-character secrets through secure environment settings:

- `JOB_TOKEN`: bot/MCP submission, planning, status and cancellation.
- `ADMIN_TOKEN`: account/target registration and manual resolution of uncertain work.
- `WORKER_CLOUD_DEV_TOKEN`: worker named `cloud-dev`. Other worker IDs use `WORKER_<ID_UPPERCASE_WITH_UNDERSCORES>_TOKEN`.

The existing `READ_TOKEN`/`WRITE_TOKEN` only operate the usage API. They cannot submit code execution. This release is single-owner; a shared JOB_TOKEN is not multi-tenant authorization. Expose over authenticated HTTPS; browser MCP Origins are rejected unless explicitly listed in `MCP_ALLOWED_ORIGINS`.

From the repository root:

```sh
pnpm --filter @llm-usage/collector register /absolute/path/worker.json
pnpm --filter @llm-usage/collector connect /absolute/path/worker.json codex-personal
pnpm --filter @llm-usage/collector connect /absolute/path/worker.json cursor-personal
pnpm --filter @llm-usage/collector connect /absolute/path/worker.json claude-personal-main
pnpm --filter @llm-usage/collector worker /absolute/path/worker.json
```

Do not run interactive `connect` as part of a service restart. Codex exposes an official device code usable from a phone. Cursor prints an official browser link with `NO_OPEN_BROWSER=1`. Claude's CLI may ask for an authorization-code handoff. For phone-only Claude connection, route a private HTTPS origin to port 8787 on the worker, then run:

```sh
LOGIN_PUBLIC_URL=https://YOUR_WORKER_ORIGIN pnpm --filter @llm-usage/collector connect:web /absolute/path/worker.json claude-personal-main
```

Open the generated one-time link on the phone, follow Claude sign-in, and paste the returned code into that page. It expires after ten minutes. The worker passes the code directly to its CLI's stdin, without storing it in the service or forwarding it through bot chat. This requires an actual HTTPS endpoint; a localhost link is not usable from a phone. Tailscale Serve on a deployed worker can provide private HTTPS. The page helper and its origin/single-use checks are tested; a real phone authorization still requires the owner.

The worker requires an administrator-confirmed `billing: "subscription"` target before it can receive a task. Keep billing `unknown` until the account's included allowance and extra-usage settings are verified. Disable provider overage/automatic credits if additional spending must always require permission; login alone does not prove that setting. Re-register to update the target after verification. API-key credentials inherited from the host are deliberately not passed to provider clients. No paid API fallback or credit purchase is implemented: planning reports approval required and tasks remain queued.

## Step-by-step decision

`POST /v1/execution/plan` (JOB_TOKEN) accepts `repository`, optional `provider` (`anthropic`, `openai`, `cursor`), `account_id`, `execution` (`auto`, `local`, `cloud`), `scope`, `model_class`, `estimated_minutes`, and `continue_job_id`.

1. Honor explicit choices, personal/work scope, repository/model availability, fresh worker/login health, cooldowns, account locks, confirmed subscription billing, and known quota exhaustion/reserves.
2. Prefer the existing eligible provider/account/environment for a verified continuation. If it cannot resume, require an explicit handoff instead of silently dropping prior work.
3. Prefer an already prepared repository environment, regardless of local/cloud location.
4. Prefer fresh provider-measured quota, then estimates, then unknown quota. Unknown is never presented as full capacity.
5. Keep candidates within five percentage points of the highest bottleneck remaining capacity after reserves.
6. Among those, prefer capacity that expires sooner: calculate usable fraction divided by hours until reset for every applicable bucket and use the minimum. A session resetting soon cannot hide a limiting weekly allowance.
7. Choose the smallest remaining setup time; a stable target ID breaks exact ties.

Every stage returns its explanation and surviving targets. Candidates include exclusions, evidence quality, each usage bucket, remaining capacity, UTC reset times and seconds left. Expected task duration flags a reset during the task but never assumes replenishment. Passed resets turn old measurements into unknown data. Previously observed exhaustion remains binding until its reported reset; Codex additionally uses the provider's explicit included-usage permission.

Codex usage is read through the official CLI app-server `account/rateLimits/read`, with percentages and epoch reset timestamps normalized into the existing snapshot contract. It never reads OAuth tokens or treats paid credit balances as included allowance. Claude and Cursor do not yet have automated quota adapters here: their quota is honestly unknown unless an authorized collector reports normalized observations to `POST /v1/execution/worker/usage`. Exact live percentages for those accounts are not claimed.

`model_class` is a configured routing label. Local targets map it to a concrete provider model using `models` in worker configuration; it is passed to the CLI. Don't register a model class that the target cannot execute. General provider selection works without a model class.

## MCP and REST

Configure any MCP client supporting authenticated Streamable HTTP with the service's HTTPS `/mcp` URL and `Authorization: Bearer <JOB_TOKEN>` supplied through its secret settings. Clients that require OAuth discovery rather than configurable bearer headers need an authenticated gateway; this service does not claim OAuth support. Available tools:

- `list_accounts`: accounts and connection targets, without credentials.
- `plan_task`: explain selection without executing.
- `submit_task`: prompt plus plan fields and a stable `idempotency_key`.
- `get_task`: status, decision, result, and a patch when small enough.
- `cancel_task`: cooperative cancellation; uncertain cloud execution is held for review.

REST equivalents are `/v1/execution/accounts`, `/plan`, `/jobs`, `/jobs/<id>`, and `/jobs/<id>/cancel`. Submission requires an `Idempotency-Key` header (16–128 letters, numbers, `_` or `-`). Worker endpoints require their own credential and `X-Worker-Id` matching the registered target. Idempotent retries return the same task; a different payload with the same key is a conflict.

A minimal submission body:

```json
{"repository":"llm-usage","prompt":"Fix the failing test and return the patch","execution":"auto","scope":"personal"}
```

## Runtime and results

The worker leases one task/account at a time, heartbeats during execution, runs the official CLI with structured arguments/stdin and bounded output/time, and saves a binary-safe Git patch in its private artifact directory. Patches up to 48,000 characters are returned in the task result; larger artifacts remain on the worker and need an authenticated artifact delivery layer. Provider-cloud task URLs are returned on completion or review. This release exposes lifecycle status, not a live token stream.

Codex worker execution and Codex cloud submission/status/diff have adapters. Cloud targets require a real configured cloud environment and authorized repository; none is fabricated by setup. Claude and Cursor worker execution have adapters. Their provider-hosted cloud targets intentionally remain unavailable until their launch/monitor/result and billing contracts are implemented and validated. Unsupported targets never masquerade as local execution.

Processes are not assumed to survive an environment snapshot. Restart the database, web service and supervised worker. OAuth state and task artifacts must persist; one active writer owns each account's credential directory. A directory and filtered environment prevent accidental credential reuse, but are not a sandbox against malicious code. Deploy untrusted coding workloads in separate per-account OS/container sandboxes with only the required mounts and network access. Do not disable CLI permissions to make a task pass. Claude permissions may deny unattended shell actions; the result must be inspected before claiming a task completed.

Expired leases and ambiguous CLI outcomes become `needs_review`, retaining the account lock. There is no automatic replay of uncertain side effects. An administrator verifies the worker/remote task has stopped, then resolves it with `POST /jobs/<id>/resolve` and a terminal result. A provider-cloud cancellation request cannot claim to cancel remote execution when the provider offers no implemented cancellation path; it is held for review.

## Validation

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. With a test-capable PostgreSQL role and DATABASE_URL, run `RUN_DB_INTEGRATION=1 pnpm --filter @llm-usage/web exec vitest run tests/execution-db.test.ts`; it creates and drops its own isolated schema. Tests cover routing/reset semantics, MCP SDK calls and HTTP initialization, scoped credentials, atomic/idempotent queue behavior, leases/recovery, provider response parsing, and the phone code handoff. Fake CLI fixtures do not establish that real subscriptions are authenticated.

The final live acceptance test still requires owner sign-in: with the Mac powered off, connect from a phone, submit a coding task, receive changes, restart the worker, and repeat. Tailscale/1Password deployment guidance is in `ai-builder-tools/cloud/README.md`.
