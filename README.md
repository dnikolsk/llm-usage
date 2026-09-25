# LLM Usage Tracker

Personal subscription capacity tracker with normalized usage snapshots and an explainable router. This first implementation pass provides the backend and a mock collector. The Claude browser adapter and iOS app are subsequent phases.

## Run locally

1. Install Node 22+, pnpm and Postgres. Run `pnpm install`.
2. Copy `apps/web/.env.example` to `apps/web/.env.local` and set `DATABASE_URL`, `READ_TOKEN`, and `WRITE_TOKEN` to independent long random values. Do not commit these.
3. Set `DATABASE_URL` in your shell, run `pnpm db:migrate`, and apply `packages/db/seeds/demo.sql` to create the demo accounts (change the labels or IDs for your own setup).
4. Run `pnpm --filter @llm-usage/web dev` and, in another terminal, `LLM_USAGE_URL=http://localhost:3000 LLM_USAGE_WRITE_TOKEN=<write token> pnpm --filter @llm-usage/collector mock-sync`.
5. Query `curl -H 'Authorization: Bearer <read token>' http://localhost:3000/v1/status` and `/v1/route?capability=coding`.

Mock data is for local development only. Its reset timestamps are derived from run time and labeled `estimated`; real adapters must preserve provider-reported timestamps. The demo account IDs must exist before ingestion.

The mock collector is a one-shot command. It does not install a five-minute scheduler or hold provider login sessions. The live Claude collector, Mac Keychain setup, and launchd job are next work after the backend is deployed and verified.

Run `pnpm test`, `pnpm typecheck`, and `pnpm build`. See `docs/architecture.md` and `openapi/openapi.yaml` for the contract. Do not deploy mock data as real account usage.

## Deployment

Connect `apps/web` as the Vercel project root, attach a Neon Postgres database, set `DATABASE_URL`, `READ_TOKEN`, and `WRITE_TOKEN`, run the migrations against that database, then deploy. Deployment is intentionally fail-closed without these values. Keep the write token only on the collector machine; read token is for trusted clients. No provider browser credentials belong in Vercel.

## Mac mini handoff

Clone the private repository with `git clone git@github.com:dnikolsk/llm-usage.git ~/Projects/llm-usage` (or use HTTPS and your preferred Projects directory). From that directory run `pnpm install` and follow the deployment section. Configure the Vercel project root as `apps/web`; execute the database migration before exercising ingestion. Run `pnpm test && pnpm typecheck && pnpm build` first. Keep all real credentials out of Git. The repository does not yet contain a deployed service or real provider adapter.
