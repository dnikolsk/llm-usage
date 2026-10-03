# Agent instructions

## Set up a new owner's instance

When asked to install or deploy this project, follow [Deploy your own](docs/deploy-your-own.md) in order. The objective is an independent deployment with the owner's own database, Vercel project, worker and provider accounts. Do not reuse the original author's service, tailnet, paths or credentials.

1. Inspect the checkout, tool versions, running services and existing configuration before changing them. Reuse working authorization and bindings. Inspect credential names/presence only; do not print secrets, environment dumps, `.env` files or provider session files.
2. Clarify only missing functional requirements: demo versus real subscriptions; which providers/repositories; an existing persistent worker versus a new machine. Default to a dedicated Vercel service and persistent worker if the owner asked for that. Owner hosting access and provider approvals remain prerequisites.
3. Prepare Node 22, pnpm 11.19.0 and PostgreSQL. Use `pnpm install --frozen-lockfile`. Work in the current checkout; do not create a Git worktree solely for setup.
4. Provision the owner's database and obtain its binding through protected secret settings. Use `pnpm setup:init --directory PRIVATE_DIRECTORY --worker-id worker-1` to generate independent role secrets. The directory must be outside the checkout and new. Existing injected role secrets are reused; existing setup directories are preserved. If the database is not yet configured, the helper reports that explicitly. It does not deploy or connect accounts.
5. Configure a new Vercel project rooted at `apps/web`, using only the generated web-role variables, including a fresh 64-hex `SESSION_KEY` (`openssl rand -hex 32`). Use an authenticated hosting tool to set values without displaying them. If no hosting tool is available, prepare the configuration and direct the owner to [the Vercel import page](https://vercel.com/new); never ask for a token in chat. Migrate the destination database before validating the deployment. Do not seed mock accounts into production.
6. Install the official provider CLIs manually or use the optional `ai-builder-tools` setup pack. Create persistent auth/artifact directories and a version-1 tools manifest; run `collector/bin/init-worker.mjs` with the owner's service URL, machine ID and allowed repository paths. Keep at least one target and remove providers the owner did not request. Multiple machines using the same real account should retain its stable account ID, so central leases apply.
7. Have the owner connect each provider once at the deployed dashboard's `/connect` page (sign in to the dashboard first). The service stores the grant and issues access tokens to workers; do not run CLI logins on the worker, request passwords/OAuth tokens in chat, or copy login state between machines. Anthropic/OpenAI/Cursor API keys are unnecessary for subscription execution. Do not silently substitute separately billed API access.
8. Confirm subscription allowance and overage settings before marking a target `billing: subscription`. Register using temporary operator/admin access, check that the dashboard shows live usage for each connected account, then start one supervised worker with only its worker secret. Do not make interactive login part of automatic startup.
9. Configure the owner's MCP client with the service's `/mcp` URL and JOB_TOKEN through client secret settings. Use bearer-header-compatible Streamable HTTP; OAuth discovery is not implemented.
10. Verify actual deployment access, measured quota, a task producing the expected patch, and a second task after an idle worker restart. Report resource identities and remaining prerequisites, never secret values. Installed binaries, generated files, fixture tests and a successful Vercel build do not prove live provider readiness.

Use `pnpm setup:run --file PRIVATE_ROLE_JSON -- COMMAND [ARGS]` when running migration, registration, client or worker commands with generated role files. This wrapper excludes unrelated inherited credentials. Load the appropriate role; never source the service's entire environment into a worker. Keep private files outside Git and provide only necessary project credentials through a separate project-specific process.

For local development only, [Getting started](docs/getting-started.md#local-demo) documents the mock demo. [Deployment](docs/deployment.md) describes credential placement, upgrades and troubleshooting. [Execution](docs/execution.md) documents API contracts, provider login and recovery.

## Code and validation

Keep provider telemetry, enrollment and credential-file code in `packages/providers`, and CLI execution adapters in `collector/src/providers/<provider>`.
Provider grants are persisted only sealed with `SESSION_KEY`; never persist plaintext credentials, HTML, or PKCE state in the database, and never return refresh tokens from any API. Timestamps stay UTC in the API.
Add tests when modifying reset semantics, routing decisions, or the public `/v1` contract.
Use feature branches and small commits; keep secrets and browser profiles out of Git.

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` for application changes. Setup helper tests are included in `pnpm test`. Use the opt-in PostgreSQL lifecycle suite for queue/store changes with a disposable database; follow the commands in the getting-started guide. For documentation-only edits, check links and affected command examples instead of rerunning unrelated suites.
