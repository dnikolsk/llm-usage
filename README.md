# LLM Usage Tracker

Personal subscription capacity tracker with normalized usage snapshots and an explainable router. The backend, mock collector, and first Claude browser collector are implemented. The iOS app is a subsequent phase.

## Run locally

1. Install Node 22+, pnpm and Postgres. Run `pnpm install`.
2. Copy `apps/web/.env.example` to `apps/web/.env.local` and set `DATABASE_URL`, `READ_TOKEN`, and `WRITE_TOKEN` to independent long random values. Do not commit these.
3. Set `DATABASE_URL` in your shell, run `pnpm db:migrate`, and apply `packages/db/seeds/demo.sql` to create the demo accounts (change the labels or IDs for your own setup).
4. Run `pnpm --filter @llm-usage/web dev` and, in another terminal, `LLM_USAGE_URL=http://localhost:3000 LLM_USAGE_WRITE_TOKEN=<write token> pnpm --filter @llm-usage/collector mock-sync`.
5. Query `curl -H 'Authorization: Bearer <read token>' http://localhost:3000/v1/status` and `/v1/route?capability=coding`.

Mock data is for local development only. Its reset timestamps are derived from run time and labeled `estimated`; real adapters must preserve provider-reported timestamps. The demo account IDs must exist before ingestion.

The mock collector is a one-shot command. For Claude collection on a Mac, install Chromium with `pnpm --filter @llm-usage/collector exec playwright install chromium`. Set `LLM_USAGE_ACCOUNT_ID=claude-personal` and run `pnpm --filter @llm-usage/collector claude login` to sign in to the dedicated browser profile. Set `LLM_USAGE_URL` to the deployed service URL and run `pnpm --filter @llm-usage/collector claude sync`. The collector reads `LLM_USAGE_WRITE_TOKEN` when set, otherwise looks up a macOS Keychain generic password with service `llm-usage-write-token` and account `llm-usage`. Add the same write token used by Vercel to that Keychain item using Keychain Access. Repeat with `claude-work` for a separate account and profile. Profiles default to `~/.llm-usage/profiles/<account-id>`; never place them in Git. The collector reads displayed session and all-model weekly percentages, leaves ambiguous reset times unknown, and reports parsing or browser failures without uploading page HTML. It has not yet been verified against a signed-in Claude page. A launchd job remains subsequent work.

Run `pnpm test`, `pnpm typecheck`, and `pnpm build`. See `docs/architecture.md` and `openapi/openapi.yaml` for the contract. Do not deploy mock data as real account usage.

## Deployment

Connect `apps/web` as the Vercel project root and attach a Neon Postgres database. The Neon integration supplies `DATABASE_URL`; store `READ_TOKEN` and `WRITE_TOKEN` as **sensitive Production environment variables** in Vercel. Generate independent random tokens of at least 32 characters. Run `vercel env run -e production -- pnpm db:migrate` from a linked checkout before deployment. Provision each real account with `vercel env run -e production -- pnpm --filter @llm-usage/db provision <account-id> anthropic '<label>' coding,chat high_reasoning`, adjusting the capability and model lists to match that account. Do not apply the demo seed to production. Deployment is intentionally fail-closed without these values or when the two tokens are identical. Store a copy of the write token in the collector Mac's Keychain and the read token only in trusted clients. Vercel cannot supply secrets directly to a Mac process. No provider browser credentials belong in Vercel.

## Mac mini handoff

Clone the private repository with `git clone git@github.com:dnikolsk/llm-usage.git ~/Projects/llm-usage` (or use HTTPS and your preferred Projects directory). From that directory run `pnpm install` and follow the deployment section. Configure the Vercel project root as `apps/web`; execute the database migration before exercising ingestion. Run `pnpm test && pnpm typecheck && pnpm build` first. Keep all real credentials out of Git. The repository does not yet contain a deployed service or a verified live provider integration.
