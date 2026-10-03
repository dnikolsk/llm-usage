# Getting started

Run commands from the repository root unless a step says otherwise. Use Bash or Zsh for the shell examples. Install Node.js 22, pnpm 11.19.0, Git and PostgreSQL with `psql`/`createdb` available. A managed PostgreSQL database is also suitable. Clone your accessible copy/fork of this repository, then:

```sh
pnpm install --frozen-lockfile
```

## Local demo

This path uses simulated Claude usage and does not sign into a provider or execute coding tasks. Use a dedicated development database; do not seed your production database.

1. Start PostgreSQL using your OS/service manager and create an empty development database:

   ```sh
   createdb llm_usage_demo
   cp apps/web/.env.example apps/web/.env.local
   ```

2. Edit `.env.local`. Set `DATABASE_URL` to your actual connection URI, such as `postgresql://YOUR_DB_USER:YOUR_DB_PASSWORD@127.0.0.1:5432/llm_usage_demo`. Configure independent random `READ_TOKEN`, `WRITE_TOKEN` and `DASHBOARD_PASSWORD` values, each at least 32 characters, and a 64-hex `LLM_SESSION_KEY` (`openssl rand -hex 32`) so provider logins can be stored. Your password manager can generate and store them. Execution secrets can stay unconfigured until the worker steps below; the example values are placeholders, never deployment credentials.

3. Load the trusted local file into this shell and migrate/seed:

   ```sh
   set -a
   source apps/web/.env.local
   set +a
   pnpm db:migrate
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/seeds/demo.sql
   pnpm --filter @llm-usage/web dev
   ```

   Next.js loads `.env.local` itself, but migrations and collector commands do not. The `source` commands assume shell-compatible assignments; quote values containing shell metacharacters. Do not source a file supplied by an untrusted party.

4. In another terminal at the same repository root, load the same trusted file and publish one mock observation:

   ```sh
   set -a
   source apps/web/.env.local
   set +a
   LLM_USAGE_URL=http://localhost:3000 LLM_USAGE_WRITE_TOKEN="$WRITE_TOKEN" \
     pnpm --filter @llm-usage/collector mock-sync
   curl --fail-with-body -H "Authorization: Bearer $READ_TOKEN" \
     http://localhost:3000/v1/status
   ```

   Expect successful ingestion for `claude-personal` and `claude-work`, followed by status containing simulated usage buckets. Open the local web server in your browser and sign in with `DASHBOARD_PASSWORD`. With no execution targets registered, the mock accounts appear in the main dashboard; after real targets are added, unregistered demo accounts move to the additional-accounts section. `/v1/route?capability=coding` is a usage-only recommendation; it does not submit a job.

The mock collector runs once. Repeat it for another observation; old values eventually become stale. No scheduler or provider login is created. For real usage, use a separate database without the demo seed and follow the next section.

## Connect a real worker

### Prepare the service and tools

Follow [deployment](deployment.md) or the local service steps above **without the demo seed**. In addition to the database/dashboard settings, provision independent `JOB_TOKEN`, `ADMIN_TOKEN`, and `WORKER_WORKER_1_TOKEN` secrets on the service. The example worker ID is `worker-1`; the same worker token must reach that worker. Remote service URLs must use HTTPS; loopback HTTP is supported for local development.

On the persistent worker, clone this repository and the Git repositories it may edit, and install dependencies here with `pnpm install --frozen-lockfile`. Install the official [Claude Code](https://code.claude.com/docs/en/setup), [Codex](https://developers.openai.com/codex/cli) and [Cursor CLI](https://cursor.com/docs/cli/installation) clients, or use the optional [machine setup pack](https://github.com/dnikolsk/ai-builder-tools/tree/feat/cloud-subscription-workers/machine). Inspect repository access using the host's existing Git authentication before requesting another credential.

Create a private persistent state directory outside the checkout. Save a tools manifest based on [tools.example.json](../config/tools.example.json), replacing every path with the absolute installed binary and chosen persistent authentication directory. Use the real CLI binary paths, not wrappers selecting another account. The manifest contains paths only; it contains no passwords or tokens.

```sh
node collector/bin/init-worker.mjs \
  --state /absolute/path/worker-state \
  --tools /absolute/path/tools.json \
  --service https://YOUR_SERVICE \
  --worker-id worker-1 \
  --repository my-project=/absolute/path/my-project
```

The generator currently prepares one personal account for each of the three providers. To run fewer providers, remove the unused entries from the generated `targets` array before registration; at least one target is required. Repeat `--repository` for each allowed project. Source repositories must be Git checkouts, and local jobs clone committed source only. A target's repository key, here `my-project`, is what clients use to submit work.

The generated `worker.json` starts with `billing: "unknown"`, refuses to overwrite an existing file, and does not register or start anything. Alternatively, copy [worker.personal.example.json](../config/worker.personal.example.json) into private storage and edit every path/identity. Tokens are environment variables, never JSON values.

### Sign in, confirm billing and register

Register first (below) so the accounts exist, then sign in to the running dashboard, open `/connect` and connect each account by completing the provider's sign-in in your browser (Claude: paste the code; Codex: paste the `localhost` address the browser lands on; Cursor: just continue). The service keeps the login; the worker will fetch access tokens from it. Nothing is signed in on the worker machine. On macOS, Cursor's issued credential is written to the OS user's `~/.cursor/auth.json`, so use one Cursor identity per OS login.

Verify included subscription access and provider overage settings. Set each verified target's `billing` to `subscription`; keep unverified targets `unknown`. There is no automatic paid fallback. Then load `ADMIN_TOKEN` temporarily from your secret manager and register:

```sh
pnpm --filter @llm-usage/collector register /absolute/path/worker-state/worker.json
unset ADMIN_TOKEN
```

In a dedicated worker shell/supervisor, inject only its `WORKER_WORKER_1_TOKEN` and required OS settings, then run:

```sh
pnpm --filter @llm-usage/collector worker /absolute/path/worker-state/worker.json
```

Do not source the web service's entire environment into the worker: it does not need database, admin, dashboard or bot credentials. The worker publishes health and fetches access tokens with its own token; usage is read by the service. Keep the process running and supervise one instance per worker. See [operations](deployment.md#operate-and-upgrade).

## Submit your first task

Use a separate bot/client shell with only `JOB_TOKEN` and your service URL supplied through secret settings. First inspect account readiness and ask for a plan:

```sh
export SERVICE_URL=https://YOUR_SERVICE
curl --fail-with-body -H "Authorization: Bearer $JOB_TOKEN" \
  "$SERVICE_URL/v1/execution/accounts"
curl --fail-with-body -H "Authorization: Bearer $JOB_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"repository":"my-project","execution":"auto","scope":"personal"}' \
  "$SERVICE_URL/v1/execution/plan"
```

If no target is selected, inspect exclusions before submitting. When a target is ready, this small task consumes real subscription allowance:

```sh
TASK_KEY="$(node -e 'console.log(require("node:crypto").randomUUID())')"
curl --fail-with-body -H "Authorization: Bearer $JOB_TOKEN" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $TASK_KEY" \
  --data '{"repository":"my-project","prompt":"Create only onboarding-smoke.txt containing hello followed by a newline. Do not install packages, commit, push or deploy. Return the patch.","execution":"auto","scope":"personal"}' \
  "$SERVICE_URL/v1/execution/jobs"
```

Keep the returned job `id`, then poll `GET /v1/execution/jobs/ID` with the same bearer authorization. Reuse the same idempotency key and request body after a lost submission response; do not create another task blindly. Review the returned patch and job state. A successful process exit alone is not proof of the intended change. This system returns patches, not automatically created PRs.

MCP clients can perform the same steps using `list_accounts`, `plan_task`, `submit_task` and `get_task`. Configure Streamable HTTP with `https://YOUR_SERVICE/mcp` and a bearer header provided through the client's secret settings. See [MCP compatibility](execution.md#mcp-and-rest).

For live acceptance, also idle-restart the worker and complete a second task without signing in again. Cloud workers should pass this check with personal laptops offline.

## Development checks

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
node --test scripts/verify-execution.test.mjs
```

The default test run skips the PostgreSQL lifecycle suite. With `DATABASE_URL` exported for a disposable development database and a role able to create/drop schemas:

```sh
RUN_DB_INTEGRATION=1 pnpm --filter @llm-usage/web exec vitest run tests/execution-db.test.ts
```

The suite creates and drops an isolated schema. Do not run it against production. Builds and fixture tests do not require real provider credentials; they do not establish that your real accounts are ready.
