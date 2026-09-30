# LLM Usage Tracker

Personal subscription capacity tracker with normalized usage snapshots and an explainable router. The backend, mock collector, and Claude, Cursor, OpenAI/Codex, and Google AI Pro collectors are implemented. The iOS app is a subsequent phase.

The live site at [llm-usage.vercel.app](https://llm-usage.vercel.app) shows a private dashboard with account status, usage windows, and a coding recommendation. Log in with the dashboard password stored separately from the API tokens. Only normalized usage data reaches the service; provider sign-ins remain on the Mac.

## Subscription billing buckets

Which subscription each model bills (routing classes match collector scopes; see [providers](docs/providers.md#subscription-billing-buckets)):

- **Astra and Sol** → ChatGPT / Codex only (`work_codex`). Never Cursor cloud or Cursor `other_models`.
- **Opus and Sonnet** → Claude (`high_reasoning`), not Cursor `other_models`.
- **Cursor's own models** → `cursor_models`. **Fable** spends Cursor's `other_models` pool; Fable is not a routable quality-ladder model — `cursor-other-models` is the pool alias in `route_task`.

## Run locally

1. Install Node 22+, pnpm and Postgres. Run `pnpm install`.
2. Copy `apps/web/.env.example` to `apps/web/.env.local` and set `DATABASE_URL`, `READ_TOKEN`, and `WRITE_TOKEN` to independent long random values. Do not commit these.
3. Set `DATABASE_URL` in your shell, run `pnpm db:migrate`, and apply `packages/db/seeds/demo.sql` to create the demo accounts (change the labels or IDs for your own setup).
4. Run `pnpm --filter @llm-usage/web dev` and, in another terminal, `LLM_USAGE_URL=http://localhost:3000 LLM_USAGE_WRITE_TOKEN=<write token> pnpm --filter @llm-usage/collector mock-sync`.
5. Query `curl -H 'Authorization: Bearer <read token>' http://localhost:3000/v1/status` and `/v1/route?capability=coding`. Set `TYPESAFE_API_KEY` for Jev-assisted `POST /v1/route`; see [task-aware routing](docs/routing.md).

Mock data is for local development only. Its reset timestamps are derived from run time and labeled `estimated`; real adapters must preserve provider-reported timestamps. The demo account IDs must exist before ingestion.

For existing sign-ins, run `pnpm --filter @llm-usage/collector claude-cli preview`, `pnpm --filter @llm-usage/collector openai-cli preview`, `pnpm --filter @llm-usage/collector cursor-cli preview`, and `pnpm --filter @llm-usage/collector google-cli preview` to read personal subscription limits without browser automation. Cursor uses its desktop app sign-in and an undocumented usage endpoint; see [provider details](docs/providers.md). Once the service is deployed, set `LLM_USAGE_URL=https://YOUR-DEPLOYMENT` and run the matching `sync` commands. The collector reads `LLM_USAGE_WRITE_TOKEN` when set, otherwise looks up a macOS Keychain generic password with service `llm-usage-write-token` and account `llm-usage`.

On the collector Mac, run `zsh collector/scripts/install-launch-agent.sh` to sync Claude, Codex, Cursor, and Google AI Pro every five minutes while logged in. The LaunchAgent PATH includes mise shims when present so a node runtime-manager install does not hide `node` from launchd. The LaunchAgent reads the provider sign-ins and write token locally; its plist contains no credentials. Logs are under `~/.llm-usage/`. Reinstall the agent after moving the repository.

Run `pnpm test`, `pnpm typecheck`, and `pnpm build`. See `docs/architecture.md` and `openapi/openapi.yaml` for the contract. Do not deploy mock data as real account usage.

## MCP connector

[`packages/mcp`](packages/mcp) is a read-only stdio MCP server (`@llm-usage/mcp`, bin `llm-usage-mcp`) that calls the deployed API. It exposes three tools: `status` (`GET /v1/status`), `route` (`GET /v1/route`, requires `capability`), and `route_task` (`POST /v1/route`, task-aware). It has no write or ingest tools, and a cloud `handoff` is only a recommendation. Set `LLM_USAGE_READ_TOKEN` (required) and optionally `LLM_USAGE_BASE_URL` (default `https://llm-usage.vercel.app`), then run:

```sh
pnpm install
LLM_USAGE_READ_TOKEN=<read token> node "$PWD/packages/mcp/bin/llm-usage-mcp.mjs"
```

See [the package README](packages/mcp/README.md) for Cursor, Claude, and Grok Bot configuration.

## Deployment

Connect `apps/web` as the Vercel project root and attach a Neon Postgres database. The Neon integration supplies `DATABASE_URL`; store `READ_TOKEN`, `WRITE_TOKEN`, an independent `DASHBOARD_PASSWORD`, and `TYPESAFE_API_KEY` as **sensitive Production environment variables** in Vercel. Generate independent random values of at least 32 characters for the three service secrets, and obtain the Jev key from TypeSafe. Run `vercel env run -e production -- pnpm db:migrate` from a linked checkout before deployment. Provision each real account with `vercel env run -e production -- pnpm --filter @llm-usage/db provision <account-id> <provider> '<label>' <capabilities> <model-classes>`, for example Claude `… provision claude-personal anthropic 'Claude Personal' coding,chat high_reasoning`, Cursor `… provision cursor-personal cursor 'Cursor Personal' coding cursor_models,other_models`, ChatGPT `… provision chatgpt-personal openai 'ChatGPT Personal' coding,chat work_codex`, Google AI Pro `… provision google-ai-pro-personal google 'Google AI Pro' coding,chat gemini_apps` — never a Gemini API billing account. Existing rows that need a class-map fix use `packages/db/scripts/align-route-classes.sql` (provision refuses conflicting updates). Do not apply the demo seed to production. API access is intentionally fail-closed without its values or when the two tokens are identical; dashboard login remains unavailable without its password. Store a copy of the write token in the collector Mac's Keychain and the read token only in trusted clients. Vercel cannot supply secrets directly to a Mac process. Provider CLI credentials stay on the Mac.

## Mac mini handoff

Clone the private repository with `git clone git@github.com:dnikolsk/llm-usage.git ~/Projects/llm-usage` (or use HTTPS and your preferred Projects directory). From that directory run `pnpm install` and follow the deployment section. Configure the Vercel project root as `apps/web`; execute the database migration before exercising ingestion. Run `pnpm test && pnpm typecheck && pnpm build` first. Keep all real credentials out of Git. The service is live at [llm-usage.vercel.app](https://llm-usage.vercel.app); authenticated ingestion from all three Mac CLI collectors has been verified.
