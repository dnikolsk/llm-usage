# LLM Usage Tracker

Personal subscription capacity tracker with normalized usage snapshots and an explainable router. The backend, mock collector, and Claude, Cursor, and OpenAI/Codex CLI collectors are implemented. The iOS app is a subsequent phase.

## Run locally

1. Install Node 22+, pnpm and Postgres. Run `pnpm install`.
2. Copy `apps/web/.env.example` to `apps/web/.env.local` and set `DATABASE_URL`, `READ_TOKEN`, and `WRITE_TOKEN` to independent long random values. Do not commit these.
3. Set `DATABASE_URL` in your shell, run `pnpm db:migrate`, and apply `packages/db/seeds/demo.sql` to create the demo accounts (change the labels or IDs for your own setup).
4. Run `pnpm --filter @llm-usage/web dev` and, in another terminal, `LLM_USAGE_URL=http://localhost:3000 LLM_USAGE_WRITE_TOKEN=<write token> pnpm --filter @llm-usage/collector mock-sync`.
5. Query `curl -H 'Authorization: Bearer <read token>' http://localhost:3000/v1/status` and `/v1/route?capability=coding`.

Mock data is for local development only. Its reset timestamps are derived from run time and labeled `estimated`; real adapters must preserve provider-reported timestamps. The demo account IDs must exist before ingestion.

For existing CLI sign-ins, run `pnpm --filter @llm-usage/collector claude-cli preview` and `pnpm --filter @llm-usage/collector openai-cli preview` to read personal subscription limits without browser automation. `pnpm --filter @llm-usage/collector cursor-cli preview` checks Cursor authentication; its personal quota remains unavailable. Once the service is deployed, set `LLM_USAGE_URL=https://YOUR-DEPLOYMENT` and run the matching `sync` commands. The collector reads `LLM_USAGE_WRITE_TOKEN` when set, otherwise looks up a macOS Keychain generic password with service `llm-usage-write-token` and account `llm-usage`. See [provider details](docs/providers.md) for Cursor's current limitation.

Run `pnpm test`, `pnpm typecheck`, and `pnpm build`. See `docs/architecture.md` and `openapi/openapi.yaml` for the contract. Do not deploy mock data as real account usage.

## Deployment

Connect `apps/web` as the Vercel project root and attach a Neon Postgres database. The Neon integration supplies `DATABASE_URL`; store `READ_TOKEN` and `WRITE_TOKEN` as **sensitive Production environment variables** in Vercel. Generate independent random tokens of at least 32 characters. Run `vercel env run -e production -- pnpm db:migrate` from a linked checkout before deployment. Provision each real account with `vercel env run -e production -- pnpm --filter @llm-usage/db provision <account-id> anthropic '<label>' coding,chat high_reasoning`, adjusting the capability and model lists to match that account. Do not apply the demo seed to production. Deployment is intentionally fail-closed without these values or when the two tokens are identical. Store a copy of the write token in the collector Mac's Keychain and the read token only in trusted clients. Vercel cannot supply secrets directly to a Mac process. Provider CLI credentials stay on the Mac.

## Mac mini handoff

Clone the private repository with `git clone git@github.com:dnikolsk/llm-usage.git ~/Projects/llm-usage` (or use HTTPS and your preferred Projects directory). From that directory run `pnpm install` and follow the deployment section. Configure the Vercel project root as `apps/web`; execute the database migration before exercising ingestion. Run `pnpm test && pnpm typecheck && pnpm build` first. Keep all real credentials out of Git. The service is not yet deployed; both CLI previews have been verified locally.
