# Architecture

Usage collector → authenticated `/v1/ingest` → append-only Postgres snapshots and buckets → authenticated `/v1/status` and deterministic `/v1/route` → clients.

The execution layer adds MCP/HTTP task submission, a durable queue, staged provider/account/target selection, and cloud-hosted official CLI workers. See [execution.md](execution.md). The original `/v1/route` remains a quota-only recommendation contract; `/v1/execution/plan` considers live worker health, billing, setup and existing sessions as well as quota.

Account IDs are stable across snapshots and providers may have many accounts. Each ingest writes a complete observation, including `partial` and `error` observations. The status API returns the most recent *successful* (`ok` or `partial`) buckets alongside the latest health result and observed time. On failure, old capacity remains visible but freshness is based on the successful observation, and routing rejects error state. Snapshot IDs and idempotency keys are unique; retrying ingestion cannot duplicate historical observations.

Bucket `reset_at` is kept as reported. Past resets make a bucket unusable for routing until a fresh observation arrives. Every timestamp in storage and JSON is UTC. The UI must format local reset and countdown values at render time. Router freshness defaults to ten minutes; after sixty minutes status is `seriously_stale`. Buckets without a measured fraction are visible but ineligible for routing.

The current `READ_TOKEN` and `WRITE_TOKEN` are personal deployment credentials. They must be independent random secrets. A future multi-user release needs scoped identities, audit logs, token rotation, and account ownership checks. No browser cookies or HTML are sent to the backend.
