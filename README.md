# LLM Usage Tracker

Track personal AI subscription capacity and ask which account/model can take the next task. This pnpm workspace includes a Next.js dashboard and API, Postgres storage, four local provider collectors, a mock collector, and a read-only stdio MCP server. There is no iOS client or cloud-job launcher in this checkout.

[GitHub](https://github.com/dnikolsk/llm-usage) is the source of truth. The existing deployment is [llm-usage.vercel.app](https://llm-usage.vercel.app); it requires its owner's credentials. The steps below create your own local instance.

## Clone and install

You need Git, Node.js 22.13+ (or a newer supported LTS), the pinned **pnpm 11.19.0**, and PostgreSQL with the `createdb` and `psql` commands available. Provider sign-ins are not needed for the demo or tests. Real collection is designed for a signed-in Mac; Cursor's desktop-token lookup and the scheduler are macOS-specific.

```sh
git clone --branch codex/jev-router https://github.com/dnikolsk/llm-usage.git
cd llm-usage
pnpm --version   # 11.19.0, as pinned in package.json
pnpm install --frozen-lockfile
```

This implementation is on `codex/jev-router`; the GitHub default branch may differ. Authenticate with GitHub if repository access requires it. Use the [pnpm installation guide](https://pnpm.io/installation/) if pnpm is missing. Run subsequent commands from this repository root unless stated otherwise.

## Run the local demo

1. Start your local PostgreSQL server, create a development database, and copy the environment template:

   ```sh
   createdb llm_usage
   cp apps/web/.env.example apps/web/.env.local
   ```

2. Edit `apps/web/.env.local`. Set `DATABASE_URL` to your local connection string (for example `postgresql://localhost:5432/llm_usage`, with your database user/password if required). Set independent random values for `READ_TOKEN`, `WRITE_TOKEN`, and `DASHBOARD_PASSWORD`. Each must be at least 32 characters; generate each separately with `openssl rand -hex 32`. Leave `TYPESAFE_API_KEY` empty unless you want task-aware routing.

   Next.js loads this file automatically. Database scripts, collectors, and MCP do **not**. To export the shell-compatible values from your own file in the current terminal:

   ```sh
   set -a
   . ./apps/web/.env.local
   set +a
   ```

3. Create tables and seed demo account inventory:

   ```sh
   pnpm db:migrate
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/seeds/demo.sql
   ```

   The seed inserts five accounts. It does not insert usage or update existing accounts. The mock collector populates only `claude-personal` and `claude-work`; the other three initially show unknown usage.

4. Start the web app:

   ```sh
   pnpm --filter @llm-usage/web dev
   ```

5. In another terminal at the repository root, load the environment as in step 2, then publish demo snapshots and query the API:

   ```sh
   LLM_USAGE_URL=http://localhost:3000 LLM_USAGE_WRITE_TOKEN="$WRITE_TOKEN" \
     pnpm --filter @llm-usage/collector mock-sync
   curl --fail-with-body -H "Authorization: Bearer $READ_TOKEN" http://localhost:3000/v1/status
   curl --fail-with-body -H "Authorization: Bearer $READ_TOKEN" \
     'http://localhost:3000/v1/route?capability=coding'
   ```

Open [localhost:3000](http://localhost:3000) and log in with `DASHBOARD_PASSWORD`. Mock resets are estimated from run time. Re-run mock sync when data becomes stale (after ten minutes). Use the demo seed and mock collector only with a development database.

## Configuration

| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | Web, database scripts | Postgres connection string |
| `READ_TOKEN` | Web | Bearer token for status and both route endpoints |
| `WRITE_TOKEN` | Web | Separate bearer token for ingestion |
| `DASHBOARD_PASSWORD` | Web | Separate dashboard login password |
| `TYPESAFE_API_KEY` | Web | Optional for the demo; required for Jev-assisted `POST /v1/route` |
| `LLM_USAGE_URL` | Collectors | API destination; individual commands default to `http://localhost:3000` |
| `LLM_USAGE_WRITE_TOKEN` | Collectors | The destination service's `WRITE_TOKEN`; real collectors can fall back to macOS Keychain |
| `LLM_USAGE_ACCOUNT_ID` | Individual real collectors | Override the provider's default inventory ID; does not select a different provider sign-in |
| `LLM_USAGE_BASE_URL` | MCP | API destination; defaults to `https://llm-usage.vercel.app` |
| `LLM_USAGE_READ_TOKEN` | MCP | The destination service's `READ_TOKEN` |

API tokens shorter than 32 characters are rejected. Equal read/write tokens disable both API roles. Dashboard login is unavailable without a password of at least 32 characters. Keep environment files, credentials, and browser profiles out of Git; see [security](docs/security.md).

## Providers and routing

| Provider | Inventory model classes | Task model IDs |
|---|---|---|
| Claude (`anthropic`) | `high_reasoning` | `claude-sonnet`, `claude-opus` |
| ChatGPT / Codex (`openai`) | `work_codex` | `gpt-6-sol`, `gpt-6-astra` |
| Cursor (`cursor`) | `cursor_models`, `other_models` | `cursor-auto`, `cursor-other-models` |
| Google AI Pro (`google`) | `gemini_apps` | `gemini-flash`, `gemini-pro` |

These are this repository's routing IDs and subscription mappings. Astra/Sol consume the ChatGPT/Codex allowance, Opus/Sonnet the Claude allowance. Fable bills Cursor's `other_models` pool but is not a selectable task model; `cursor-other-models` is the pool alias. Claude collector buckets use `all_models`, which applies to its `high_reasoning` routes. See [provider collection, provisioning, and scheduling](docs/providers.md).

`GET /v1/route` chooses an account using measured capacity, reserves, freshness, and resets; its filters are optional. `POST /v1/route` adds Jev task judgment, model selection, continuity, renewal pace, and local/cloud placement. Cloud placement returns an unstarted recommendation. See [the routing rules and request example](docs/routing.md) and [OpenAPI](openapi/openapi.yaml).

## MCP connector

The [MCP package](packages/mcp/README.md) exposes `status`, `route` (requires `capability`), and `route_task`. It runs directly from the installed checkout; no separate build is required. For your local instance, after loading the environment:

```sh
LLM_USAGE_BASE_URL=http://localhost:3000 LLM_USAGE_READ_TOKEN="$READ_TOKEN" \
  node "$PWD/packages/mcp/bin/llm-usage-mcp.mjs"
```

This is a stdio server intended for an MCP host, not an interactive shell. See the package README for host configuration.

## Test and build

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Tests use fixtures and mocks; they do not require a database, provider sign-ins, or production tokens. The database package currently has no tests. `lint` runs TypeScript checks, not a separate style linter. The root build builds the Next.js app. To serve that build locally:

```sh
pnpm --filter @llm-usage/web exec next start
```

For changes, follow [AGENTS.md](AGENTS.md). Keep provider-specific collection/authentication in `collector/src/providers/<provider>`. Add tests for reset semantics, routing decisions, or changes to the public `/v1` contract.

## Deploy your own instance

Connect your GitHub checkout to Vercel with **Root Directory `apps/web`** and workspace files outside that directory available to the build. Attach a Postgres database (the existing deployment uses Neon), and configure `DATABASE_URL`, independent `READ_TOKEN`, `WRITE_TOKEN`, and `DASHBOARD_PASSWORD` secrets. Add `TYPESAFE_API_KEY` for task-aware routing. Configure secrets for each environment you intend to use.

With the Vercel CLI installed and the repository root linked to your project (`vercel link`), apply the migration using [Vercel's environment runner](https://vercel.com/docs/cli/env):

```sh
vercel env run -e production -- pnpm db:migrate
```

Alternatively, export the target database's `DATABASE_URL` in your shell and run `pnpm db:migrate`. Provision real accounts using [the provider guide](docs/providers.md#provision-real-accounts); do not apply the demo seed to production. Deploy after configuration and migration. Set the collector destination to your deployment and provide its write token locally; Vercel does not transfer secrets to the collector Mac.

## Repository map

- `apps/web`: dashboard, authentication, `/v1` handlers, and Jev client.
- `packages/core`: normalized schemas and routing algorithms.
- `packages/db`: schema, migration, account provisioning, and demo seed.
- `collector`: provider adapters, publish client, and macOS scheduling scripts.
- `packages/mcp`: read-only stdio client of the API.
- `docs/architecture.md`, `docs/security.md`: data flow and security boundaries.
- `docs/product/`: historical implementation briefs, not current setup instructions.
