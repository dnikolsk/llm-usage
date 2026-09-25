# Providers

The mock collector proves the normalized contract. The preferred collectors reuse existing CLI sign-ins without browser profiles or cookie handling:

- `claude-cli preview` invokes Claude Code's built-in `claude -p /usage` in an empty private directory and parses its session and all-model weekly percentages. The reset text is local-time prose, so `reset_at` stays unknown.
- `openai-cli preview` reads structured Work/Codex five-hour and weekly limits from the installed Codex CLI's local app-server. It keeps reported reset timestamps in UTC.

Run the matching `sync` command after deployment with `LLM_USAGE_URL` set. Both publish only normalized snapshots. Missing meters become unknown buckets, so routing will not mistake absent measurements for free capacity.

Cursor [does not currently expose a public API or CLI command for individual subscription usage](https://forum.cursor.com/t/usage-api-cli-command/160967/5). Its Admin API is for teams and must not be confused with a personal subscription. The Cursor CLI can be signed in while still offering no personal quota reading. Leave Cursor capacity unknown in a browser-free setup rather than inferring it from token logs or API billing.

The following browser collectors are experimental legacy adapters. They require dedicated local Chromium profiles and are not part of the recommended browser-free setup:

- `claude` reads displayed session and weekly all-model percentages from Claude Settings → Usage.
- `cursor` reads the separate monthly **Cursor Models** and **Other Models** included-usage pools from the [Spending dashboard](https://prod.cursor.com/help/models-and-usage/usage-limits). On-demand spend is excluded. A plan with only one pool will yield a partial observation until plan-aware absence is implemented.
- `chatgpt` reads the five-hour and weekly **Work/Codex** allowance from ChatGPT Settings → Usage. [OpenAI describes these as shared allowances](https://help.openai.com/fr-ca/articles/20001516-managing-usage-with-gpt-6-astra-in-work-and-codex). It does not represent ordinary chat-message limits, API billing, or purchased credits. Its bucket scope is `work_codex`.

The Cursor bucket scopes are `cursor_models` and `other_models`. A route filtered to a model class needs the corresponding account `model_classes` entry. For example, provision Cursor with `cursor_models,other_models` and ChatGPT with `work_codex` when setting up new accounts. Until those account records are updated, an unfiltered route considers all reported pools, while a class-filtered route correctly rejects a class that has not been declared. xAI can later use the same snapshot contract.
