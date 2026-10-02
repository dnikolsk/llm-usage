# Subscription coding tasks and MCP

The usage API remains compatible. Execution is an additional authenticated service: a durable PostgreSQL queue, staged planner, per-account workers, and a Streamable HTTP MCP endpoint at `/mcp`. The service never stores provider credentials. Provider login code belongs under `collector/src/providers/<provider>`.

For a first installation, start with [Getting started](getting-started.md). This page is the detailed runtime and API reference; [deployment](deployment.md) covers credential placement and ongoing operations.

## Prepared personal accounts

`config/worker.personal.example.json` registers Codex personal (`codex-personal`), Claude personal (`claude-personal-main`), and Cursor personal (`cursor-personal`). The `-main` suffix separates the real Claude account from the original mock seed. Mock accounts have no execution targets and cannot run tasks. Registration does not claim successful sign-in or available subscription billing.

Install the official clients manually or use the optional [machine setup pack](https://github.com/dnikolsk/ai-builder-tools/tree/feat/cloud-subscription-workers/machine). Configure repository paths and persistent account/artifact directories in a private worker JSON file. Never put tokens or OAuth material in it. The example contains placeholder paths and a `my-project` repository key; replace every path before use. The worker clones each local task into its own directory; it does not create Git worktrees or modify the source checkout. Only committed source is cloned. Provider-cloud execution operates on the provider's configured repository/branch, not local uncommitted files.

Migrate with `DATABASE_URL=... pnpm db:migrate`. Start the web service. Provide independent, at least 32-character secrets through secure environment settings:

- `JOB_TOKEN`: bot/MCP submission, planning, status and cancellation.
- `ADMIN_TOKEN`: account/target registration and manual resolution of uncertain work.
- `WORKER_WORKER_1_TOKEN`: example worker named `worker-1`. Other worker IDs use `WORKER_<ID_UPPERCASE_WITH_UNDERSCORES>_TOKEN`.

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

Phone links use an inline HTML response and a `.html` path. The form includes an independent, single-use verification value, so an embedded browser may omit provenance headers or send an opaque `Origin: null`. Explicitly conflicting origins, referrers, cross-site fetch metadata, and missing/invalid form values are rejected. Keep `LOGIN_PUBLIC_URL` equal to the actual public HTTPS origin, including a non-default port such as 8443. After updating or restarting the connection helper, use its new link and a fresh Claude authorization code; old pages and codes belong to the previous login attempt.

The worker requires an administrator-confirmed `billing: "subscription"` target before it can receive a task. Keep billing `unknown` until the account's included allowance and extra-usage settings are verified. Disable provider overage/automatic credits if additional spending must always require permission; login alone does not prove that setting. Re-register to update the target after verification. API-key credentials inherited from the host are deliberately not passed to provider clients. No paid API fallback or credit purchase is implemented: planning reports approval required and tasks remain queued.

### Cursor says logged in but rejects tokens

Cursor's `status --format json` can return `isAuthenticated: true` when stored tokens exist even if fetching the user from the server fails. The worker therefore also runs the official `models` command and requires a successful available-model list before reporting readiness. This checks backend authentication without running an inference task. A network failure or an account with no available models also prevents readiness; this check does not prove remaining subscription allowance.

For stale or rejected tokens, pause the worker while idle, then reconnect the configured account from the repository root using the same worker configuration:

```sh
pnpm --filter @llm-usage/collector connect /absolute/path/worker.json cursor-personal --reconnect
```

This runs official Cursor logout and login in that account's configured credential directory, prints the phone browser link, then checks backend model access. It does not modify Claude or Codex credentials or use an API key. Complete the new browser flow, wait for `Cursor backend accepted the login and returned available models.`, then restart the worker. If verification still fails, investigate the Cursor service/network and CLI version rather than copying tokens or treating local status as success. Existing uncertain jobs still require review; reconnecting does not replay them.

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

Codex usage is read through the official CLI app-server `account/rateLimits/read`, with percentages and epoch reset timestamps normalized into the existing snapshot contract. It never reads OAuth tokens or treats paid credit balances as included allowance. Claude and Cursor are collected on the worker too. Claude reads `/api/oauth/usage` for five-hour, seven-day and provider-reported model-specific utilization/reset windows. Cursor reads `DashboardService/GetCurrentPeriodUsage` and `GetPlanInfo` for included allowance, Auto/named-model breakdowns, and the included-allowance reset when provided (otherwise the provider's current period end). Dollar-denominated included usage stays in cents; percentages are not represented as token counts. Neither extra Claude usage nor Cursor on-demand spend expands subscription capacity.

These two adapters use the authenticated telemetry endpoints used by the installed provider clients, not a guaranteed public API. Their response contracts are validated; changed schemas, denied access and unavailable credential stores produce explicit diagnostic codes instead of invented capacity. Credentials are read only from the configured account's local CLI store and sent only to fixed provider HTTPS origins, with redirects disabled. They are never forwarded to this service. CLI login/refresh continues to own credentials: the collectors never rewrite or copy them. Cursor uses the official file credential store: `auth_dir/config/cursor/auth.json` on Linux, and `~/.cursor/auth.json` on macOS. On a Mac, the Cursor file store is shared by that OS user, so use one personal Cursor identity per OS user; do not configure multiple Cursor identities under that login. Claude uses `auth_dir/.credentials.json`. Keychain-only credentials are not extracted; an existing Mac keychain login may require one new browser sign-in into the file store.

Before claiming a task, the worker refreshes each ready account's telemetry when at least 60 seconds have elapsed, backing off to five minutes after provider throttling. This happens between tasks; a long-running task can leave measurements stale, which the router exposes. Failed refreshes publish an error observation, retain the last successful reading for inspection, and prevent it from being called measured capacity. Known exhaustion remains binding until reset. MCP `list_accounts` now includes normalized usage, observed/reset times, freshness and a safe diagnostic code; `plan_task` includes source, confidence and observation time for each applicable bucket. Model scopes are matched to the concrete execution model as described below; the common allowance always applies.

For live acceptance on the deployed worker, with its existing worker credential loaded and the worker idle:

```sh
pnpm --filter @llm-usage/collector usage:sync /absolute/path/worker.json
```

This reads and publishes normalized telemetry for all three accounts, prints no credentials or raw provider responses, and exits nonzero if any collection fails. Then call MCP `list_accounts` and `plan_task`: compare each account's percentage and UTC reset to its provider usage screen. Require real readings for all three before calling telemetry deployment verified. `usage_credentials_missing` means the configured local credential file is absent; `usage_auth_required` means the token expired or the telemetry endpoint denied access; `usage_rate_limited` requires waiting for backoff; other unavailable/schema errors require adapter investigation. Do not reconnect working task authentication merely because a telemetry endpoint denies access. No live provider acceptance is claimed by fixture tests.

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

The final live acceptance test still requires owner sign-in: with the Mac powered off, connect from a phone, submit a coding task, receive changes, restart the worker, and repeat. See [deployment](deployment.md) for supervision, Tailscale and 1Password options.

### Deployed subscription verification

With the deployed worker running and its existing `JOB_TOKEN` loaded securely, run from this checkout (Node 22+):

```sh
node scripts/verify-execution.mjs /absolute/path/worker.json /private/path/verification
node scripts/verify-execution.mjs /absolute/path/worker.json /private/path/verification --run
```

The helper defaults to repository key `ai-builder-tools` for compatibility. Pass `--repository YOUR_KEY` to use your own registered repository. The first command only reads accounts and plans automatic routing plus explicit Claude, Codex and Cursor routing for that repository. `plans.json` records exclusions, quota evidence, all applicable reset buckets and each decision step. An unavailable provider is reported without fabricating readiness. The second command submits one small task using automatic routing and real subscription allowance: create a uniquely named text file in the task's repository checkout. Review `changes.patch` for the expected new file and no unintended changes. `job.json` records the actual execution decision (which may differ from preflight), status and result. Success requires both a successful job state and the expected text in a returned patch; it is not a full audit of all changes or proof that every provider can execute.

Use the same output directory to resume after a connection loss or verification-process restart. The request and idempotency key are saved before submission; rerunning retrieves the same task. A ten-minute monitoring timeout leaves the job intact. A `needs_review` outcome requires inspecting the existing job and artifact, not creating a fresh attempt. Output contains task metadata and code; keep the directory private and outside source control. The helper never saves the service token or prints provider credentials. It does not enable billing, reconnect accounts, restart services, or automatically cancel work.

After the first successful task, restart the supervised worker while idle and run with a new output directory to verify a new task can complete without another login. Record a service restart separately from this helper's interrupted-monitoring test. PostgreSQL integration tests exercise lease expiration and prevent replay of uncertain work; a live worker-restart check still needs to happen on the deployed host. Keep real recovery testing away from valuable running jobs.

Helper regression checks: `node --test scripts/verify-execution.test.mjs`.


### Bind models to usage pools

Execution plans now include `model` and `quota_scope`. Cursor defaults to explicit `--model auto`; both the combined included allowance and `cursor_auto` pool constrain it. Named Cursor models conservatively require the `cursor_api` pool. Missing pool telemetry blocks that Cursor candidate instead of substituting the combined percentage. The adapter does not yet infer named own-model exceptions to that conservative classification. Exhausted pools are excluded even if the combined allowance is high. A null reset remains null.

Worker target configuration accepts `default_model`, and its existing `models` map binds a requested model class to a concrete CLI model. Registration now publishes those bindings. Claude Sonnet/Opus scopes are derived from the concrete model, including behind a class such as `reasoning`; when no recognizable model is bound, both family limits apply conservatively. An explicit cloud model binding is unavailable until that cloud adapter supports it. No new provider model IDs are invented.

The worker passes the planned model to the CLI and rejects configuration drift rather than substituting another model. Cursor continuations retain their previous model/pool; a missing historical model binding or a requested change requires explicit handoff. Restarting does not silently switch an exhausted named-model session to Auto.

When Cursor's `includedSpend / limit` differs from its reported percentage by over two percentage points, the included bucket carries `usage_amount_percentage_conflict`. The collector omits the contradictory monetary fields, preserves the reported percentage, and the planner exposes the warning. This is a reported inconsistency, not an inferred dollar balance.

Deploy while idle: stop the worker, pull, rebuild, restart the web service, and re-register with the existing private worker config (`pnpm --filter @llm-usage/collector register /absolute/path/worker.json`, using the existing ADMIN_TOKEN), then start the single worker. Refresh usage. Verify `plan_task` for Cursor with no model class shows `model: auto`, `quota_scope: cursor_auto`, and both applicable buckets; a configured named-model request must be excluded while its pool is exhausted. Run one Auto smoke task and inspect the claimed job's model and patch. Existing sign-ins need no change.


### Compact dashboard

The `/` page uses `DASHBOARD_PASSWORD` cookie sign-in. Set an independent random password of at least 32 characters on first deployment and preserve it during upgrades; there is no public usage view or client-side service token. The screen shows remaining capacity, reset countdowns, worker connectivity and a repository-specific execution plan. Additional buckets, source confidence and diagnostics expand per account. Passed resets, failed collection and stale readings display unknown rather than suggesting restored capacity. Times are Eastern Time. Visible tabs refresh once a minute; this refreshes the view, not the provider collectors.

### Machine setup and worker enrollment ownership

`ai-builder-tools` installs the tools and manages host supervision, 1Password integration and the machine authentication checklist. This repository owns worker configuration, account/target defaults, registration, provider adapters and execution. Existing workers do not need a configuration migration for this separation.

The setup pack's `setup.sh init-worker --checkout /path/to/llm-usage …` delegates to this checkout's `collector/bin/init-worker.mjs`. The same command is available directly, without installing collector dependencies first:

```sh
node collector/bin/init-worker.mjs \
  --state /absolute/path/ai-builder \
  --tools /absolute/path/ai-builder/tools.json \
  --service https://YOUR_PRIVATE_SERVICE \
  --worker-id my-machine \
  --repository my-project=/absolute/path/my-project
```

With dependencies installed, `pnpm --filter @llm-usage/collector worker:init` accepts the same arguments. Repeat `--repository` as needed; `--output` overrides the default `STATE/worker.json`. Generation is local and refuses to overwrite an existing config. It does not sign in, register, start a worker or modify the service. Registration remains `pnpm --filter @llm-usage/collector register CONFIG` with temporary admin authentication.

The installer provides a version-1 JSON manifest with `providers` entries named `codex`, `claude`, and `cursor-agent`, each containing absolute `binary` and `auth_dir` paths. No credentials belong in this manifest. Tool versions and installation layout remain installer decisions; enrollment does not duplicate those pins. If upgrading an older setup pack, regenerate its launchers/manifest before enrolling a new worker. Update both repositories to versions supporting this interface.
