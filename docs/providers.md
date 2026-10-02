# Provider support

Provider modules live under `collector/src/providers/<provider>`. Each worker keeps its own official CLI session; the service receives normalized usage and task results, never provider credentials. Account ownership and applicable provider subscription terms remain the operator's responsibility.

| Provider | CLI execution on worker | Usage source | Provider-hosted tasks |
| --- | --- | --- | --- |
| Codex / ChatGPT (`openai`) | Supported adapter | Official CLI app-server `account/rateLimits/read` | Adapter available; requires a real cloud environment and authorized repository |
| Claude Code (`anthropic`) | Supported adapter | Authenticated `/api/oauth/usage`: five-hour, seven-day and model-specific windows | Not implemented |
| Cursor (`cursor`) | Supported adapter; explicit Auto default | Authenticated `GetCurrentPeriodUsage` and `GetPlanInfo`: included/Auto/API pools | Not implemented |

Claude and Cursor telemetry contracts are not guaranteed public APIs. Authentication failure, unavailable local stores, rate limiting and schema changes produce diagnostics rather than fabricated capacity. Telemetry requests use fixed provider HTTPS origins and do not follow redirects. The collector does not rewrite provider sessions.

All supported adapters normalize percentages and preserve provider reset timestamps. A missing reset remains null, and a passed reset requires a new observation. Paid credits, extra usage and on-demand spend do not expand included subscription capacity. Cursor's pool restrictions and conflicting percentage/dollar fields are documented in [model-to-pool routing](execution.md#bind-models-to-usage-pools).

Linux workers use configured persistent account directories. On macOS, Cursor's file credential store is `~/.cursor/auth.json`, shared by the OS user; only one Cursor identity per OS login is supported. Keychain-only sessions are not extracted. Mac setup/launchd needs acceptance on real hardware; Linux fixture tests do not establish Mac readiness.

The [mock collector](getting-started.md#local-demo) publishes simulated Claude observations only. It neither logs in nor proves execution. For real acceptance, sign in, collect usage, compare it with the provider dashboard, run an explicit task, inspect the returned patch, then repeat after an idle worker restart. See [execution](execution.md) for connection commands and diagnostics.
