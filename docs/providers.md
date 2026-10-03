# Provider support

Provider telemetry and login code lives in `packages/providers` (`@llm-usage/providers`), shared by the web service and the worker. Every provider implements the same observer interface: begin an enrollment, complete it with what the person pastes back, refresh a grant, read usage, and emit the official CLI's credential file **without** refresh material. CLI execution adapters (arguments, result parsing) remain under `collector/src/providers/<provider>`.

| Provider | Enrollment from `/connect` | Live usage source | CLI credential file issued to workers | Provider-hosted tasks |
| --- | --- | --- | --- | --- |
| Claude Code (`anthropic`) | PKCE against the public Claude Code client; paste the code Claude shows | `api.anthropic.com/api/oauth/usage`: five-hour, seven-day and model-specific windows, extra-usage budget | `auth_dir/.credentials.json` | Not implemented |
| Codex / ChatGPT (`openai`) | PKCE against the public Codex CLI client; paste the loopback redirect address the browser lands on | `chatgpt.com/backend-api/wham/usage`: primary/secondary windows, credits | `auth_dir/auth.json` | Adapter available; requires a real cloud environment and authorized repository |
| Cursor (`cursor`) | The CLI's browser hand-off; the service polls for completion | `api2.cursor.sh` `GetCurrentPeriodUsage` and `GetPlanInfo`: included/Auto/API pools | Linux `auth_dir/config/cursor/auth.json`; macOS `~/.cursor/auth.json` | Not implemented |
| Gemini (`google`) | Google OAuth with the public Gemini CLI client; paste the code Google shows | Code Assist `retrieveUserQuota`: per-model daily request quota; the common allowance is the tightest model (labeled estimated) | `auth_dir/.gemini/oauth_creds.json`, with the CLI's HOME set to `auth_dir` | Not implemented |

These are the authenticated endpoints the official clients use, not guaranteed public APIs. Authentication failure, rate limiting and schema changes produce diagnostics (`usage_auth_required`, `usage_rate_limited`, `usage_schema_unrecognized`, …) rather than fabricated capacity. Requests go only to fixed provider HTTPS origins with redirects disabled, with bounded response sizes; bodies are never surfaced.

Usage is read **live**: the dashboard, `/v1/status` and MCP call the providers at request time, sharing one reading per account within a 20-second window. There is no scheduled collector. Workers do not read usage at all.

All adapters normalize percentages and preserve provider reset timestamps. A missing reset remains null, and a passed reset requires a new observation. Paid credits, extra usage and on-demand spend do not expand included subscription capacity. Cursor's pool restrictions and conflicting percentage/dollar fields are documented in [model-to-pool routing](execution.md#bind-models-to-usage-pools).

## What the dashboard numbers mean

| Provider | Included subscription usage | Paid section | Missing values |
| --- | --- | --- | --- |
| Claude | Five-hour, seven-day and reported model windows | Extra-usage spending budget: used, limit and derived headroom, in USD | Disabled means the provider reported extra usage disabled; null amounts do not prove a zero wallet balance |
| Codex | Primary/session and secondary/weekly windows | Provider credit balance | Credits are not tokens or dollars; no conversion is inferred |
| Cursor | Included, Auto and API/named-model pools | On-demand spending used, limit and provider-reported remainder, in USD | A spending limit is not a prepaid balance; remaining may be unreported even when used/limit exist |
| Gemini | Code Assist quota per model | No paid-credit reader implemented | Unknown stays unknown |

Resets retain the provider's UTC timestamp; the dashboard renders Eastern Time, including daylight-saving changes. An idle Claude five-hour window may have no reset while its seven-day window still has one. Inspect each window separately. Paid data is display-only and cannot make a routing candidate eligible. See [missing-data troubleshooting](troubleshooting.md).

## Live acceptance caveats

Known caveats for live acceptance (each needs one real sign-in and a comparison against the provider's own usage screen):

- Claude: a five-hour window that is idle reports no reset; the dashboard shows “Reset not reported”.
- Codex: the backend usage endpoint and the pasted-redirect enrollment follow the CLI's current behavior and may change without notice. Until the Codex session is connected, Codex usage is unknown.
- Cursor: tokens are JWTs whose expiry the service reads; a rejected refresh requires one new sign-in. On macOS the Cursor file store is shared by the OS user, so one Cursor identity per OS login.
- Gemini: quota comes from the Code Assist API the Gemini CLI uses, which may differ from what the Gemini app shows for a Google AI Pro subscription. Quota is per model with a daily reset; the Gemini CLI has no auth-status command, so worker readiness means the service-issued credential file is present. Session continuation is not supported.

The [mock collector](getting-started.md#local-demo) still seeds simulated Claude observations for the local demo only; it neither logs in nor proves anything about live reads.
