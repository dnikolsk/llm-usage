# Deploy your own

Use your own GitHub copy, Vercel project, PostgreSQL database and provider subscriptions. Your dashboard receives its own `*.vercel.app` address. A persistent Mac/Linux worker runs the coding CLIs; the Vercel project hosts the dashboard, API and MCP endpoint.

An agent can perform the steps below. Ask it:

> Read AGENTS.md and docs/deploy-your-own.md, then set up my own instance. Reuse my existing authorization and ask me only for missing functional choices or account approvals. Store secrets through protected settings, never display them in chat. Connect my chosen providers, verify quota and a small patch-producing task, then verify an idle restart. Tell me which steps are verified and which still need my action.

## 1. Create your hosting resources

[Fork this repository](https://github.com/dnikolsk/llm-usage/fork) into your GitHub account. Open [Vercel's new project page](https://vercel.com/new), authorize your GitHub connection and import your fork. Select Next.js and set **Root Directory → `apps/web`**. Use the repository's pnpm workspace and lockfile; allow workspace files outside the root when needed.

Create an empty PostgreSQL database through your chosen provider (for example Neon through Vercel's marketplace) and obtain its connection URI through protected settings. Keep previews separate from production. Retain the release checkout locally/on the agent machine for migration and setup commands.

This is a guided import, not automatic resource provisioning: GitHub/Vercel sign-in, database access and any hosting charges are controlled by the owner. Provider sign-in is a later step.

## 2. Generate private configuration

Install Node 22 and pnpm 11.19.0, then from your checkout:

```sh
pnpm install --frozen-lockfile
pnpm setup:init --directory "$HOME/.llm-usage-owner" --worker-id worker-1
```

If `DATABASE_URL` is already securely injected, it is included in the relevant files. Otherwise the command reports `database_configured: false`: bind your database URI to `DATABASE_URL` in both the web and operator role files using a trusted local editor/secret-management tool before migrations. The files use JSON, so punctuation in secret values is not interpreted as shell code. Do not paste their contents into chat.

The command creates a new private directory, mode 700, with mode-600 files. It reuses valid independent role secrets already injected into its environment, generates missing secrets, and refuses to overwrite an existing directory. It prints only directory/worker metadata. Treat these files as a local bootstrap bundle; a password manager or host secret store can hold the live bindings afterward.

| File | Process allowed to receive its values |
| --- | --- |
| `web-secrets.json` | Vercel/Next.js service: database and all server-side role bindings |
| `worker-secrets.json` | This worker only: its machine-specific token |
| `client-secrets.json` | Bot/MCP client: job and usage-read tokens |
| `operator-secrets.json` | Temporary migration/registration session: database and admin token |
| `setup.json` | Nonsecret machine ID, role-file names and setup metadata |


## 3. Deploy your page

Through your authorized Vercel tool or project environment settings, bind the keys in `web-secrets.json`'s `variables` object to server-side variables. Keep values out of tool output/chat and do not use `NEXT_PUBLIC_*` names. `DATABASE_URL`, `DASHBOARD_PASSWORD`, independent role tokens and `WORKER_WORKER_1_TOKEN` must have your own values.

Run migrations with only the operator role:

```sh
pnpm setup:run --file "$HOME/.llm-usage-owner/operator-secrets.json" -- pnpm db:migrate
```

Then deploy the Vercel project, or redeploy after changing its environment. Visit its assigned HTTPS URL and sign in with your generated dashboard password from your local secret store. An empty account list is expected before worker registration. No demo seed is needed.

The wrapper takes variables from the selected role file and basic OS/network settings; unrelated inherited API, admin and vault credentials are excluded. It does not establish a sandbox or authorize arbitrary commands. Use it only with trusted setup commands.

## 4. Connect your worker and accounts

Follow [Connect a real worker](getting-started.md#connect-a-real-worker) to install CLIs, create a tools manifest, and generate the execution config. Use your Vercel HTTPS origin, `--worker-id worker-1`, and repository keys/paths you actually own. The provider defaults are personal Claude, Codex and Cursor; remove unrequested targets before registration.

Sign in to your dashboard and open `/connect`. Add each account (same IDs as the worker config) and connect it: the page runs the provider's own sign-in and stores the login in your service, sealed with `SESSION_KEY`. This is subscription authentication: it does not require Anthropic/OpenAI/Cursor API keys, and the worker never logs in itself. Verify included billing/overage settings before marking targets `subscription`.

Register and start the worker from the checkout:

```sh
pnpm setup:run --file "$HOME/.llm-usage-owner/operator-secrets.json" -- \
  pnpm --filter @llm-usage/collector register /absolute/path/worker-state/worker.json
pnpm setup:run --file "$HOME/.llm-usage-owner/worker-secrets.json" -- \
  pnpm --filter @llm-usage/collector worker /absolute/path/worker-state/worker.json
```

The last command is a foreground process. Run it under your host supervisor for persistence, keeping exactly one active process. If service and worker are on different machines, bind only the worker token through that host's protected secret settings; do not transfer the entire owner bundle. The optional setup pack supports 1Password-backed startup; it needs an authorized desktop integration or a scoped cloud service account when your plan supports it.

## 5. Verify and connect your agent

With a worker running, use a second terminal/client environment. Substitute your registered repository key for `my-project`:

```sh
pnpm setup:run --file "$HOME/.llm-usage-owner/client-secrets.json" -- \
  node scripts/verify-execution.mjs /absolute/path/worker-state/worker.json \
  /absolute/private/path/first-check --repository my-project
```

This only reads accounts/plans. When an eligible target is available, repeat with `--run` to consume subscription allowance and create a small test file in an isolated task clone. It saves the job and patch for review; it does not commit/push/deploy. Keep the same output directory to resume an interrupted check. Restart the idle supervised worker, then use a new output directory with `--run` to verify a second task without re-login.

Finally configure your bot/agent's authenticated Streamable HTTP MCP connection:

- URL: `https://YOUR_VERCEL_PROJECT.vercel.app/mcp`
- Header: `Authorization: Bearer <your JOB_TOKEN>`, supplied through its secret settings
- Tools: `list_accounts`, `plan_task`, `submit_task`, `get_task`, `cancel_task`

The dashboard login password is separate from MCP authentication. Clients requiring OAuth discovery need an authenticated gateway; see [MCP reference](execution.md#mcp-and-rest). For browser clients, configure exact `MCP_ALLOWED_ORIGINS` on the service when required.

Report success only after dashboard access, real quota, a reviewed task patch and an idle-restart check pass. See [operations and troubleshooting](deployment.md) for recovery, upgrades and credential rotation.
