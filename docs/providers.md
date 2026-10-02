# Providers

The mock collector proves the original normalized contract. Real execution now uses provider modules under `collector/src/providers`: Codex, Claude Code, and Cursor CLI on a Linux worker. Authentication remains worker-local in a separate account directory; it is not tied to a Mac or sent to the service. Personal and work accounts remain separate routing scopes.

Codex usage is read via the official CLI app-server and normalized into measured buckets. Claude/Cursor quota adapters are not yet implemented: absent observations stay unknown. Only publish genuinely measurable buckets; never infer an exact percentage from a plan name. See [execution.md](execution.md) for login flows, supported execution targets and the live-account validation still required.
