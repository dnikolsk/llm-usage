# Providers

The four real collectors reuse existing local sign-ins and publish normalized snapshots. `preview` reads usage without contacting the llm-usage service; `sync` sends the result to `/v1/ingest`. Install and sign in to the relevant provider tools yourself before collecting. A different `LLM_USAGE_ACCOUNT_ID` changes the inventory label attached to the observation, not the provider identity being read.

| Command (after `pnpm --filter @llm-usage/collector`) | Default account ID | Local dependency | Measured buckets / scope |
|---|---|---|---|
| `claude-cli preview` | `claude-personal` | Signed-in `claude` CLI | Session and all-model week / `all_models` |
| `openai-cli preview` | `chatgpt-personal` | Signed-in `codex` CLI | Five-hour session and week / `work_codex` |
| `cursor-cli preview` | `cursor-personal` | Signed-in Cursor desktop on macOS; `cursor-agent` for fallback | Monthly `cursor_models` and `other_models` |
| `google-cli preview` | `google-ai-pro-personal` | Signed-in Antigravity `agy` CLI | Five-hour session and week / `gemini_apps` |

## What the adapters read

Claude invokes `claude -p /usage --output-format text --permission-mode plan` in a private probe directory (`~/.llm-usage/cli-probe`). It parses the current session and all-model weekly percentages. It does not parse local-time reset prose, so reset timestamps and window lengths remain unknown. If only one meter is found, the snapshot is `partial` and includes an unknown bucket for the missing meter; routing excludes it for unknown capacity.

OpenAI starts `codex app-server --stdio` and requests `account/rateLimits/read`. It reads the `codex` allowance's 300-minute and 10,080-minute windows, preserving reported reset timestamps in UTC. It does not measure ordinary ChatGPT chat-message limits, API billing, or purchased credits. A missing meter is an unknown bucket, as with Claude.

Cursor reads the desktop app's access token in memory from its local SQLite state database and calls the undocumented `GetCurrentPeriodUsage` endpoint. `autoPercentUsed` maps to `cursor_models`; `apiPercentUsed` maps to `other_models`. Billing-cycle timestamps supply the monthly window and reset. A single measured pool yields `partial` with only that pool; a route for the missing scope has no applicable limits. If desktop usage is unavailable, it runs `cursor-agent status --format json`: an authenticated CLI yields `partial`, no limits, and `personal_usage_unavailable`; a signed-out check yields `error`. CLI invocation failures yield `cli_collection_failed`. No allowance is inferred from token logs or API billing. This private endpoint can change.

Google runs `agy -p /usage --output-format json` and parses only Gemini/Google AI groups, ignoring groups named Claude, GPT, or API. It records measured five-hour and weekly remaining fractions and converts reported resets to UTC. A single measured window yields `partial` with only that window. Detected authentication failures yield `error` with `sign_in_required`; missing executables or other invocation failures yield `cli_collection_failed`. Unrecognized output yields `usage_values_unavailable`. This adapter is for the Google AI Pro subscription, not Gemini API or Cloud billing; Gemini API keys are not used.

Unknown values are never treated as free capacity. Partial observations replace the previous successful bucket set; they do not merge missing buckets from older observations. An error observation has no limits; status retains the previous successful buckets for display but routing rejects the error health state.

## Subscription billing buckets

These are the mappings implemented by `packages/core/src/task-routing.ts`, not a general catalog of models a provider might offer:

| Task model IDs | Subscription | Inventory class | Collector scope |
|---|---|---|---|
| `gpt-6-astra`, `gpt-6-sol` | ChatGPT / Codex | `work_codex` | `work_codex` |
| `claude-opus`, `claude-sonnet` | Claude | `high_reasoning` | `all_models` |
| `cursor-auto` | Cursor Models | `cursor_models` | `cursor_models` |
| `cursor-other-models` | Cursor Other Models | `other_models` | `other_models` |
| `gemini-flash`, `gemini-pro` | Google AI Pro | `gemini_apps` | `gemini_apps` |

Astra and Sol never route against Cursor pools; Opus and Sonnet route against Claude. Fable bills Cursor's `other_models` pool but is not a routable quality-ladder model ID. `cursor-other-models` is the pool alias. `all_models` buckets apply across an account's model classes; otherwise class-filtered routing requires a matching bucket scope. Tagging a Cursor or OpenAI account only `general` makes it invisible to the task model map.

## Provision real accounts

Export the target database's `DATABASE_URL` first. From the repository root, provision only the accounts you will collect:

```sh
pnpm --filter @llm-usage/db provision claude-personal anthropic 'Claude Personal' coding,chat high_reasoning
pnpm --filter @llm-usage/db provision chatgpt-personal openai 'ChatGPT Personal' coding,chat work_codex
pnpm --filter @llm-usage/db provision cursor-personal cursor 'Cursor Personal' coding cursor_models,other_models
pnpm --filter @llm-usage/db provision google-ai-pro-personal google 'Google AI Pro' coding,chat gemini_apps
```

For a linked Vercel project, prefix each command with `vercel env run -e production --` to use that environment. Provisioning inserts inventory only; repeated identical commands succeed, but conflicting settings are refused. Existing default Cursor/ChatGPT rows with old classes can be aligned with [`packages/db/scripts/align-route-classes.sql`](../packages/db/scripts/align-route-classes.sql), after checking the target database and IDs. It updates only `cursor-personal` and `chatgpt-personal`.

## Collect and publish

```sh
pnpm --filter @llm-usage/collector claude-cli preview
LLM_USAGE_URL=https://YOUR-DEPLOYMENT \
  pnpm --filter @llm-usage/collector claude-cli sync
```

Repeat with `openai-cli`, `cursor-cli`, or `google-cli`. Individual commands default to `http://localhost:3000`. Set `LLM_USAGE_WRITE_TOKEN` to the destination service's write token, or store it in macOS Keychain as a generic password with service `llm-usage-write-token` and account `llm-usage` (for example using Keychain Access). The mock collector requires the environment variable and does not use Keychain.

Provider credentials remain local. Preview prints normalized fields only. A successful sync means the observation was accepted; inspect its printed `ok`, `partial`, or `error` status to tell whether collection succeeded. Account IDs and providers must match inventory or ingestion returns 404.

## Schedule on macOS

The supplied LaunchAgent syncs all four default accounts every five minutes while the user is logged in, and once immediately when installed. First verify each manual preview/sync and store the write token in Keychain; the installer does not embed tokens or inherit your interactive shell configuration.

```sh
LLM_USAGE_URL=https://YOUR-DEPLOYMENT zsh collector/scripts/install-launch-agent.sh
```

The installer records the destination in `~/Library/LaunchAgents/com.llm-usage.collector.plist`. If omitted, it retains the existing default `https://llm-usage.vercel.app`; set it explicitly for your own instance. The scheduler uses the default account IDs above. Its PATH includes mise shims, `~/.local/bin`, and standard Homebrew paths. Other runtime-manager paths must be made available there. The installer also needs `/usr/bin/python3`.

Logs are `~/.llm-usage/collector.log` and `~/.llm-usage/collector.err.log`. Reinstall with the intended URL after moving the checkout or changing the destination. To run all four once manually:

```sh
LLM_USAGE_URL=https://YOUR-DEPLOYMENT zsh collector/scripts/sync-all.sh
```

To stop scheduling:

```sh
launchctl bootout "gui/$(id -u)/com.llm-usage.collector"
rm "$HOME/Library/LaunchAgents/com.llm-usage.collector.plist"
```
