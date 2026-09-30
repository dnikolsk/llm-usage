# Architecture

Local provider collectors → authenticated `POST /v1/ingest` → Postgres snapshots and buckets → authenticated status and routing APIs → dashboard and read-only stdio MCP client.

## Workspace boundaries

- `collector/src/providers/<provider>` reads local provider sign-ins and normalizes usage. CLI wrappers preview or publish snapshots; the service never receives provider credentials or raw HTML.
- `packages/core` owns validation, freshness, deterministic account routing, and task model selection.
- `packages/db` owns Postgres tables, the initial migration, and account provisioning. Inventory must exist before ingestion; collectors cannot create accounts.
- `apps/web` serves the Next.js dashboard and `/v1` API. Its store loads inventory, observations, and reserve policy. The dashboard reads the store directly after cookie authentication.
- `packages/mcp` is a stdio HTTP client of `/v1`, authenticated with the read token. It has no database connection or write tools.

`GET /v1/route` is deterministic. `POST /v1/route` sends the submitted task and project stage to TypeSafe Jev for difficulty/work-pattern judgments, then runs capacity, continuity, quality, pace, and placement rules locally in the service. It does not persist the task or Jev response. A cloud handoff is a recommendation with `status=not_started`; no job is launched. See [routing](routing.md).

## Observations and freshness

Account IDs are stable across snapshots and providers may have many accounts. Each ingest appends a complete observation, including `partial` and `error` observations. Status returns the most recent successful (`ok` or `partial`) bucket set alongside the latest health result. A partial snapshot replaces that set in full. On error, old capacity remains visible but routing rejects the error health state.

`observed_at` is the successful observation time used for freshness; `latest_refresh_at` is the latest observation time, including errors. At up to ten minutes old the data is `fresh`, after ten minutes it is `stale`, and after sixty minutes it is `seriously_stale`. Missing timestamps or timestamps more than one minute in the future have unknown freshness. Routing requires fresh data.

Bucket resets are retained from provider observations and normalized to UTC where needed. A reset at or before the routing time excludes the bucket until a fresh observation updates it; the service does not replenish quotas automatically. Unknown remaining fractions are visible but ineligible. Reset timestamps may be null without excluding measured capacity. The dashboard currently formats times server-side in `America/New_York` (Eastern Time), not the viewer’s time zone.

## Storage and ingestion

The initial migration creates `accounts`, `usage_snapshots`, `usage_buckets`, and `routing_policies`. It is repeatable (`CREATE ... IF NOT EXISTS`), not a versioned migration runner. Snapshots and buckets are append-only through the API; inventory and policies are configured through database access.

Ingestion validates the normalized schema, requires an observation within 24 hours of server time, and checks account/provider identity. Idempotency keys are globally unique: an identical normalized payload with the same key is a duplicate; a different payload with that key conflicts. The real publish client hashes the normalized payload to form its key. The mock collector uses random keys.

The deployment is a single-owner service. `READ_TOKEN`, `WRITE_TOKEN`, and `DASHBOARD_PASSWORD` are independent credentials; database operations require `DATABASE_URL`. Timestamps returned by the API use UTC. See [security](security.md) and [OpenAPI](../openapi/openapi.yaml).
