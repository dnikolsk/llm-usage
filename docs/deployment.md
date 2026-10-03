# Deployment and operations

For a first independent deployment, follow [Deploy your own](deploy-your-own.md), including private role-file generation and agent instructions.

Deploy a Next.js control service, PostgreSQL, and at least one persistent CLI worker. The service can run on Vercel or a Node host. Workers need their own long-lived Mac/Linux process and persistent storage; Vercel request handlers do not host CLI tasks.

This release is single-owner. Shared tokens grant the associated role across the deployment; they are not per-user permissions. Give other operators their own instance rather than exposing yours as a public multi-tenant service.

## Configuration and credential placement

All bearer tokens and the dashboard password must be independent random values of at least 32 characters. Names below describe bindings; never place actual values in Git, an issue, a task prompt, or a `NEXT_PUBLIC_*` variable.

| Setting | Where it belongs | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Web service; temporary migration environment | PostgreSQL connection |
| `DASHBOARD_PASSWORD` | Web service; owner's password manager | Dashboard login and cookie signing |
| `READ_TOKEN` | Web service; trusted usage clients | `/v1/status` and `/v1/route` |
| `WRITE_TOKEN` | Web service; independent usage collectors | `/v1/ingest`; subscription workers use their own credential instead |
| `JOB_TOKEN` | Web service; bot/MCP clients | Plan, submit, inspect and cancel jobs |
| `ADMIN_TOKEN` | Web service; temporary operator environment | Register accounts/targets and resolve uncertain jobs |
| `WORKER_<ID>_TOKEN` | Web service and exactly the corresponding worker | Worker health, telemetry, leases and results |
| `MCP_ALLOWED_ORIGINS` | Web service, when required | Comma-separated exact allowed browser origins |
| `LOGIN_PUBLIC_URL` | Temporary Claude connection helper | Private HTTPS origin that reaches its worker-side login page |
| Provider OAuth/session files | Persistent worker storage only | Official CLI authentication |

For ID `worker-1`, the server expects `WORKER_WORKER_1_TOKEN`. Hyphens become underscores and the ID is uppercased. Set `token_env` in the worker JSON to the matching name. Avoid IDs that normalize to the same variable (for example `worker-a` and `worker_a`). Missing role secrets disable that role; the dashboard password is not an API token.

Copy [`.env.example`](../apps/web/.env.example) for local development. Next.js reads `.env.local`; migration/collector shells need their required variables injected separately. Managed PostgreSQL providers commonly require `sslmode=require`; follow your provider's connection instructions.

MCP accepts header-configured bearer authentication, not OAuth discovery. Requests with a browser Origin are denied unless that exact origin is configured. Do not use `*` as an origin policy. Tailscale can provide private reachability, but does not replace application tokens. A client and server must both be able to reach the chosen private endpoint.

## Vercel

1. Import your accessible repository/fork, select **Next.js**, and set the project root to `apps/web`. Enable access to files outside that root for workspace dependencies if the project settings require it; install using the checked-in pnpm workspace and lockfile.
2. Provision PostgreSQL and configure the web-service secrets above for the intended Vercel environment. Preview and production should use separate databases and secrets; previews can otherwise operate production queues.
3. From a trusted checkout at the release commit, inject the destination `DATABASE_URL` into a migration shell and run `pnpm db:migrate`. This applies all ordered migrations, including `0002_execution.sql`. Do not apply `seeds/demo.sql` to production.
4. Deploy the web service. Confirm dashboard sign-in and authenticated `GET /v1/status` work. Once accounts are enrolled, check `/v1/execution/accounts` using `JOB_TOKEN` too.
5. Enroll/start the persistent worker using the service's HTTPS origin, refresh usage, then complete a small task and inspect its patch.

Deployment does not create provider sessions, start a worker, seed accounts, or grant provider-cloud repository access. Changes to Vercel environment variables require a new deployment to take effect.

## Other Node hosts

Install dependencies and migrate the destination database, then build from the root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @llm-usage/web exec next start --hostname 127.0.0.1 --port 3000
```

Run the last command under your host's supervisor and inject web-service secrets there. Put authenticated HTTPS termination/reverse proxying in front of it. For containers, adapt the bind address to your container networking. Retain the monorepo runtime files/dependencies needed by Next.js; no Docker image or standalone bundle is supplied here.

## Operate and upgrade

- Supervise one worker process for each worker ID. Persist its config, provider auth directories, repository checkouts and artifact directory across restarts. The setup pack offers systemd/launchd templates; manual supervision is also supported.
- On a Mac, launchd user jobs require the OS user to sign in and the machine to stay awake. Use a persistent Linux host for availability independent of your laptop.
- Keep interactive `connect` flows out of automatic startup. Provider login may eventually require owner reauthorization; no unattended refresh guarantee is made for all providers.
- 1Password is optional. The setup pack can resolve a worker token through desktop approval or an unattended service account when your plan supports it. A cloud service account needs a host-injected bootstrap credential. Do not copy rotating provider OAuth sessions through the vault.
- For upgrades, let the worker become idle and stop it, back up the database, update the checkout, install frozen dependencies, run migrations, build/deploy the web service, and re-register if target configuration changed. Restart the single worker, refresh usage and run a small acceptance task. Preserve existing secrets and provider profiles.
- Back up PostgreSQL and protect worker artifacts as private source code. Small patches are returned by the API; larger patches stay on the worker and need a separate authenticated retrieval path.
- Rotate compromised credentials at both ends. Update a worker token on the service and in the worker's secret source, then restart/redeploy as appropriate. Dashboard password rotation invalidates existing dashboard sessions.

A worker directory and filtered environment are not a security sandbox. Isolate untrusted repositories/tasks with appropriate OS/container boundaries. Do not solve permission errors by disabling provider safeguards.

## Troubleshooting

For missing reset dates or paid balances, run the [read-only live usage diagnostic](usage-diagnostics.md) on the worker host and inspect its shareable JSON report before changing services.

| Symptom | Check |
| --- | --- |
| Dashboard cannot sign in | `DASHBOARD_PASSWORD` is configured, at least 32 characters, and deployed |
| API returns 401 | Correct role-specific bearer token, same server/client binding, minimum length |
| Database/service returns 503 | Database reachability, required migrations, server logs without credential dumps |
| No eligible route | Plan exclusions: billing confirmation, repository key, worker health, model binding, quota freshness/exhaustion |
| Quotas unknown or stale | Run worker `usage:sync` while idle; inspect diagnostic codes and provider access rather than assuming full allowance |
| Private MCP has usage but Vercel lacks dates or paid balances | Check whether they use different services/databases; configure [usage mirroring](execution.md#a-separate-vercel-usage-dashboard) and retire the old publisher |
| Cursor reports logged in but is unavailable | Backend model access may reject stored tokens; use the documented [reconnect flow](execution.md#cursor-says-logged-in-but-rejects-tokens) |
| Jobs stay queued | Matching worker ID/token, allowed repository, supervised process, subscription eligibility |
| `needs_review` | Inspect the existing job and remote process; an admin must resolve uncertainty before retrying |
| Phone cannot open Claude login | Private HTTPS reachability, actual origin including port, current one-time link; see [connection flow](execution.md#prepared-personal-accounts) |
| MCP client insists on OAuth | Use a client supporting bearer headers or an authenticated gateway; the server does not implement OAuth discovery |

Collect diagnostic codes, timestamps and job IDs for a bug report. Redact secrets, session URLs, repository content and provider response bodies before sharing logs.
